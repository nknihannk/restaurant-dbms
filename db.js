'use strict';
// Database connection + first-run sample data.
const fs = require('fs');
const path = require('path');

// Tiny .env reader so no extra package is needed.
function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
    }
  }
}
loadEnv();

const mysql = require('mysql2/promise');

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};
const DB_NAME = 'restaurant_db';

const pool = mysql.createPool({
  ...config,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

const TABLES = [
  [1, 2], [2, 2], [3, 4], [4, 4], [5, 4], [6, 6], [7, 6], [8, 8],
];

const MENU = [
  ['Masala Dosa', 'Breakfast', 60],
  ['Idli (2 pcs)', 'Breakfast', 30],
  ['Appam & Stew', 'Breakfast', 90],
  ['Parotta', 'Mains', 15],
  ['Chicken Biryani', 'Mains', 180],
  ['Veg Biryani', 'Mains', 140],
  ['Paneer Butter Masala', 'Mains', 200],
  ['Chicken Curry', 'Mains', 150],
  ['Fried Rice', 'Mains', 120],
  ['Gobi Manchurian', 'Starters', 110],
  ['Fresh Lime Soda', 'Drinks', 40],
  ['Masala Chai', 'Drinks', 15],
  ['Cold Coffee', 'Drinks', 70],
  ['Gulab Jamun', 'Desserts', 40],
  ['Payasam', 'Desserts', 50],
];

// Adds sample tables and menu items only when those tables are empty.
async function seedIfEmpty() {
  const [t] = await pool.execute('SELECT COUNT(*) AS n FROM RestaurantTable');
  if (Number(t[0].n) === 0) {
    for (const [no, cap] of TABLES) {
      await pool.execute('INSERT INTO RestaurantTable (table_no, status, capacity) VALUES (?, ?, ?)', [no, 'free', cap]);
    }
  }
  const [m] = await pool.execute('SELECT COUNT(*) AS n FROM Menu');
  if (Number(m[0].n) === 0) {
    for (const [name, cat, price] of MENU) {
      await pool.execute('INSERT INTO Menu (item_name, category, price) VALUES (?, ?, ?)', [name, cat, price]);
    }
  }
}

module.exports = { pool, config, seedIfEmpty };
