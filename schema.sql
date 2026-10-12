-- Restaurant DBMS schema (same 7 tables as the ER diagram).
-- Safe to run more than once: every statement uses IF NOT EXISTS.

CREATE DATABASE IF NOT EXISTS restaurant_db;
USE restaurant_db;

CREATE TABLE IF NOT EXISTS Customer (
  customer_id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(50),
  phone VARCHAR(15)
);

CREATE TABLE IF NOT EXISTS RestaurantTable (
  table_no INT PRIMARY KEY,
  status VARCHAR(20) DEFAULT 'free',
  capacity INT
);

CREATE TABLE IF NOT EXISTS Menu (
  item_id INT PRIMARY KEY AUTO_INCREMENT,
  item_name VARCHAR(80),
  category VARCHAR(40),
  price DECIMAL(8,2)
);

CREATE TABLE IF NOT EXISTS Booking (
  booking_id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT,
  expected_pickup_time DATETIME,
  advance_amount DECIMAL(8,2),
  status VARCHAR(20),
  FOREIGN KEY (customer_id) REFERENCES Customer(customer_id)
);

CREATE TABLE IF NOT EXISTS Orders (
  order_id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT,
  table_no INT,
  booking_id INT NULL,
  order_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'placed',
  FOREIGN KEY (customer_id) REFERENCES Customer(customer_id),
  FOREIGN KEY (table_no) REFERENCES RestaurantTable(table_no),
  FOREIGN KEY (booking_id) REFERENCES Booking(booking_id)
);

CREATE TABLE IF NOT EXISTS OrderItems (
  order_id INT,
  item_id INT,
  quantity INT,
  PRIMARY KEY (order_id, item_id),
  FOREIGN KEY (order_id) REFERENCES Orders(order_id),
  FOREIGN KEY (item_id) REFERENCES Menu(item_id)
);

CREATE TABLE IF NOT EXISTS Bill (
  bill_id INT PRIMARY KEY AUTO_INCREMENT,
  order_id INT UNIQUE,
  payment_status VARCHAR(20) DEFAULT 'unpaid',
  FOREIGN KEY (order_id) REFERENCES Orders(order_id)
);
