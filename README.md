# Restaurant Database Management System

DBMS course project. The database (MySQL, `restaurant_db`, 7 tables) is the main part.
The website only reads and writes that database.

## Run it (Windows)

1. Make sure MySQL is running (Windows "Services" -> MySQL80 -> Running) and Node.js is installed.
2. Double-click **run.bat**.
   - First time it asks for your MySQL root password, installs the one package it needs, creates the
     database/tables if they are missing, adds sample menu and tables, and starts the app.
3. Open in a browser:
   - Customer page: http://localhost:3000/?table=1  (change the number for each table's QR code)
   - Staff panel: http://localhost:3000/staff
4. To open it on a phone: connect the phone to the same Wi-Fi and use the "From a phone" address
   printed in the black window.

Manual way: `npm install`, `npm run setup`, `npm start`. Passwords live in `.env` (see `.env.example`).

## What each part does

| Screen | What it does | Tables used |
|---|---|---|
| Customer page | Customer enters name and phone, picks items, places orders, sees the bill, pays | Customer, Menu, RestaurantTable, Orders, OrderItems, Bill |
| Staff panel | Shows open orders by table, updates order status, marks paid, shows sales, edits menu prices | all of the above |

How the design matches the ER diagram:
- **Bill total is not stored.** It is calculated as `SUM(Menu.price x OrderItems.quantity)` in SQL.
- **One bill per order:** `Bill.order_id` is `UNIQUE`.
- **OrderItems** has the composite key `(order_id, item_id)`. Ordering the same item again adds to the quantity.
- **Customer** is identified by phone number (no login).
- **One active (unpaid) order per table.** Ordering again at the same table adds to that order.
- Paying sets Bill = paid, Order = completed, Table = free.

## Moving to another laptop

The project is plain text files, so it can be edited on any laptop with VS Code.
1. Copy the whole folder (pen drive / Drive). Do not copy `.env` or `node_modules`.
2. On the other laptop install Node.js (LTS) and MySQL Server, then double-click `run.bat`.
   It creates the database, tables and sample data by itself. Orders placed on the first laptop are not copied.
   If you need that data too, use Workbench: Server -> Data Export, then Data Import on the other laptop.

## Not built yet

- **Booking** (pre-booking with advance payment): the table exists in the database, but the website does not use it yet.
- No login for staff. Anyone who opens /staff can use it.
- Payment is simulated (a button), not a real payment gateway.
- A bill uses the current menu price. If a price changes while an order is still unpaid, that bill changes too.
