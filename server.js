'use strict';
// Backend: a small web server that turns button clicks into SQL queries.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pool, seedIfEmpty } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const ACTIVE_STATUSES = ['placed', 'preparing', 'served'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- helpers ----------
function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

async function withTx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// The bill is never stored. The total is calculated from Menu price x OrderItems quantity.
async function getBill(db, orderId) {
  const [head] = await db.execute(
    `SELECT o.order_id, o.table_no, o.status, o.order_time,
            c.name, c.phone, b.bill_id, b.payment_status
       FROM Orders o
       JOIN Customer c ON c.customer_id = o.customer_id
       JOIN Bill b ON b.order_id = o.order_id
      WHERE o.order_id = ?`,
    [orderId]
  );
  if (!head.length) throw new HttpError(404, 'Order not found.');
  const [items] = await db.execute(
    `SELECT m.item_id, m.item_name, m.price, oi.quantity,
            (m.price * oi.quantity) AS line_total
       FROM OrderItems oi
       JOIN Menu m ON m.item_id = oi.item_id
      WHERE oi.order_id = ?
      ORDER BY m.item_name`,
    [orderId]
  );
  const [tot] = await db.execute(
    `SELECT COALESCE(SUM(m.price * oi.quantity), 0) AS total
       FROM OrderItems oi
       JOIN Menu m ON m.item_id = oi.item_id
      WHERE oi.order_id = ?`,
    [orderId]
  );
  const h = head[0];
  return {
    order_id: h.order_id,
    bill_id: h.bill_id,
    table_no: h.table_no,
    status: h.status,
    order_time: h.order_time,
    customer: { name: h.name, phone: h.phone },
    payment_status: h.payment_status,
    items: items.map((i) => ({
      item_id: i.item_id,
      item_name: i.item_name,
      price: Number(i.price),
      quantity: Number(i.quantity),
      line_total: Number(i.line_total),
    })),
    total: Number(tot[0].total),
  };
}

// ---------- routes ----------
const routes = [];
function route(method, pattern, handler) {
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
  routes.push({ method, re, handler });
}

route('GET', '/api/menu', async () => {
  const [rows] = await pool.execute(
    'SELECT item_id, item_name, category, price FROM Menu ORDER BY category, item_name'
  );
  return rows.map((r) => ({ ...r, price: Number(r.price) }));
});

route('GET', '/api/tables', async () => {
  const [rows] = await pool.execute(
    'SELECT table_no, status, capacity FROM RestaurantTable ORDER BY table_no'
  );
  return rows;
});

// Customer places an order. If the table already has an unpaid order, items are added to it.
route('POST', '/api/order', async ({ body }) => {
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').replace(/[\s-]/g, '');
  const tableNo = toInt(body.table_no);
  if (!name || name.length > 50) throw new HttpError(400, 'Please enter your name (up to 50 characters).');
  if (!/^\+?\d{10,13}$/.test(phone)) throw new HttpError(400, 'Please enter a valid phone number.');
  if (tableNo === null) throw new HttpError(400, 'Please choose your table.');

  const merged = new Map();
  for (const it of Array.isArray(body.items) ? body.items : []) {
    const id = toInt(it.item_id);
    const qty = toInt(it.quantity);
    if (id === null || qty === null || qty < 1 || qty > 20) {
      throw new HttpError(400, 'Each item quantity must be between 1 and 20.');
    }
    merged.set(id, (merged.get(id) || 0) + qty);
  }
  if (!merged.size) throw new HttpError(400, 'Your cart is empty.');
  const ids = [...merged.keys()];

  const orderId = await withTx(async (c) => {
    const [tbl] = await c.execute('SELECT table_no FROM RestaurantTable WHERE table_no = ?', [tableNo]);
    if (!tbl.length) throw new HttpError(404, 'That table does not exist.');

    const [found] = await c.execute(
      `SELECT item_id FROM Menu WHERE item_id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    if (found.length !== ids.length) throw new HttpError(400, 'One of the items is no longer on the menu.');

    // Customer is identified by phone number (no login).
    let customerId;
    const [cust] = await c.execute('SELECT customer_id FROM Customer WHERE phone = ?', [phone]);
    if (cust.length) {
      customerId = cust[0].customer_id;
    } else {
      const [ins] = await c.execute('INSERT INTO Customer (name, phone) VALUES (?, ?)', [name, phone]);
      customerId = ins.insertId;
    }

    // One active (unpaid) order per table.
    const [active] = await c.execute(
      `SELECT o.order_id
         FROM Orders o
         JOIN Bill b ON b.order_id = o.order_id
        WHERE o.table_no = ? AND b.payment_status = 'unpaid'
        ORDER BY o.order_id DESC
        LIMIT 1`,
      [tableNo]
    );
    let id;
    if (active.length) {
      id = active[0].order_id;
      await c.execute("UPDATE Orders SET status = 'placed' WHERE order_id = ?", [id]);
    } else {
      const [o] = await c.execute('INSERT INTO Orders (customer_id, table_no) VALUES (?, ?)', [customerId, tableNo]);
      id = o.insertId;
      await c.execute('INSERT INTO Bill (order_id) VALUES (?)', [id]);
      await c.execute("UPDATE RestaurantTable SET status = 'occupied' WHERE table_no = ?", [tableNo]);
    }

    for (const [itemId, qty] of merged) {
      const [row] = await c.execute(
        'SELECT quantity FROM OrderItems WHERE order_id = ? AND item_id = ?',
        [id, itemId]
      );
      if (row.length) {
        await c.execute(
          'UPDATE OrderItems SET quantity = quantity + ? WHERE order_id = ? AND item_id = ?',
          [qty, id, itemId]
        );
      } else {
        await c.execute('INSERT INTO OrderItems (order_id, item_id, quantity) VALUES (?, ?, ?)', [id, itemId, qty]);
      }
    }
    return id;
  });

  return getBill(pool, orderId);
});

// Current unpaid bill for a table (or null).
route('GET', '/api/table/:no/bill', async ({ params }) => {
  const no = toInt(params.no);
  if (no === null) throw new HttpError(400, 'Invalid table.');
  const [rows] = await pool.execute(
    `SELECT o.order_id
       FROM Orders o
       JOIN Bill b ON b.order_id = o.order_id
      WHERE o.table_no = ? AND b.payment_status = 'unpaid'
      ORDER BY o.order_id DESC
      LIMIT 1`,
    [no]
  );
  return { bill: rows.length ? await getBill(pool, rows[0].order_id) : null };
});

// Payment at the table: bill -> paid, order -> completed, table -> free.
route('POST', '/api/pay/:id', async ({ params }) => {
  const id = toInt(params.id);
  if (id === null) throw new HttpError(400, 'Invalid order.');
  await withTx(async (c) => {
    const [rows] = await c.execute(
      `SELECT o.table_no, b.payment_status
         FROM Orders o
         JOIN Bill b ON b.order_id = o.order_id
        WHERE o.order_id = ?`,
      [id]
    );
    if (!rows.length) throw new HttpError(404, 'Order not found.');
    if (rows[0].payment_status === 'unpaid') {
      await c.execute("UPDATE Bill SET payment_status = 'paid' WHERE order_id = ?", [id]);
      await c.execute("UPDATE Orders SET status = 'completed' WHERE order_id = ?", [id]);
      await c.execute("UPDATE RestaurantTable SET status = 'free' WHERE table_no = ?", [rows[0].table_no]);
    }
  });
  return getBill(pool, id);
});

// Staff panel: every unpaid order with its items and calculated total.
route('GET', '/api/staff/orders', async () => {
  const [orders] = await pool.execute(
    `SELECT o.order_id, o.table_no, o.status, o.order_time, c.name, c.phone
       FROM Orders o
       JOIN Customer c ON c.customer_id = o.customer_id
       JOIN Bill b ON b.order_id = o.order_id
      WHERE b.payment_status = 'unpaid'
      ORDER BY o.order_time ASC, o.order_id ASC`
  );
  if (!orders.length) return [];
  const ids = orders.map((o) => o.order_id);
  const marks = ids.map(() => '?').join(',');
  const [items] = await pool.execute(
    `SELECT oi.order_id, m.item_name, oi.quantity
       FROM OrderItems oi
       JOIN Menu m ON m.item_id = oi.item_id
      WHERE oi.order_id IN (${marks})
      ORDER BY m.item_name`,
    ids
  );
  const [totals] = await pool.execute(
    `SELECT oi.order_id, SUM(m.price * oi.quantity) AS total
       FROM OrderItems oi
       JOIN Menu m ON m.item_id = oi.item_id
      WHERE oi.order_id IN (${marks})
      GROUP BY oi.order_id`,
    ids
  );
  const totalOf = new Map(totals.map((t) => [t.order_id, Number(t.total)]));
  return orders.map((o) => ({
    ...o,
    items: items
      .filter((i) => i.order_id === o.order_id)
      .map((i) => ({ item_name: i.item_name, quantity: Number(i.quantity) })),
    total: totalOf.get(o.order_id) || 0,
  }));
});

route('POST', '/api/staff/orders/:id/status', async ({ params, body }) => {
  const id = toInt(params.id);
  const status = String(body.status || '');
  if (id === null) throw new HttpError(400, 'Invalid order.');
  if (!ACTIVE_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status.');
  const [rows] = await pool.execute('SELECT payment_status FROM Bill WHERE order_id = ?', [id]);
  if (!rows.length) throw new HttpError(404, 'Order not found.');
  if (rows[0].payment_status === 'paid') throw new HttpError(409, 'This order is already paid.');
  await pool.execute('UPDATE Orders SET status = ? WHERE order_id = ?', [status, id]);
  return { ok: true };
});

// Change a price once - every new bill uses it (single source of truth).
route('PUT', '/api/menu/:id', async ({ params, body }) => {
  const id = toInt(params.id);
  const price = Number(body.price);
  if (id === null) throw new HttpError(400, 'Invalid item.');
  if (!Number.isFinite(price) || price <= 0 || price >= 100000) {
    throw new HttpError(400, 'Price must be a number greater than 0.');
  }
  const [r] = await pool.execute('UPDATE Menu SET price = ? WHERE item_id = ?', [price.toFixed(2), id]);
  if (!r.affectedRows) throw new HttpError(404, 'Item not found.');
  return { ok: true };
});

route('GET', '/api/stats', async () => {
  const [rev] = await pool.execute(
    `SELECT COALESCE(SUM(m.price * oi.quantity), 0) AS revenue
       FROM Bill b
       JOIN OrderItems oi ON oi.order_id = b.order_id
       JOIN Menu m ON m.item_id = oi.item_id
      WHERE b.payment_status = 'paid'`
  );
  const [cnt] = await pool.execute("SELECT COUNT(*) AS n FROM Bill WHERE payment_status = 'paid'");
  const [top] = await pool.execute(
    `SELECT m.item_name, SUM(oi.quantity) AS qty
       FROM Bill b
       JOIN OrderItems oi ON oi.order_id = b.order_id
       JOIN Menu m ON m.item_id = oi.item_id
      WHERE b.payment_status = 'paid'
      GROUP BY m.item_id, m.item_name
      ORDER BY qty DESC
      LIMIT 5`
  );
  return {
    revenue: Number(rev[0].revenue),
    paid_bills: Number(cnt[0].n),
    top_items: top.map((t) => ({ item_name: t.item_name, qty: Number(t.qty) })),
  };
});

// ---------- web server ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new HttpError(413, 'Request too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new HttpError(400, 'Invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const text = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

function serveStatic(pathname, res) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/staff') rel = '/staff.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, 'Not found.');
      const params = url.pathname.match(r.re).groups || {};
      const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {};
      return sendJson(res, 200, await r.handler({ params, body }));
    }
    return serveStatic(url.pathname, res);
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    console.error(err);
    return sendJson(res, 500, { error: 'Something went wrong on the server.' });
  }
});

function explain(err) {
  if (err.code === 'ECONNREFUSED') return 'MySQL is not running. Open Windows "Services", find MySQL80 and click Start.';
  if (err.code === 'ER_ACCESS_DENIED_ERROR') return 'Wrong MySQL password. Check DB_PASSWORD in the .env file.';
  if (err.code === 'ER_BAD_DB_ERROR' || err.code === 'ER_NO_SUCH_TABLE') return 'Database not set up yet. Run: npm run setup';
  return err.message;
}

(async () => {
  try {
    await seedIfEmpty();
  } catch (err) {
    console.error('Cannot use the database: ' + explain(err));
    process.exit(1);
  }
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\nRestaurant app is running.');
    console.log('  Customer page : http://localhost:' + PORT + '/?table=1');
    console.log('  Staff panel   : http://localhost:' + PORT + '/staff');
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    if (lan) console.log('  From a phone on the same Wi-Fi: http://' + lan.address + ':' + PORT + '/?table=1');
    console.log('\nPress Ctrl+C to stop.\n');
  });
})();
