// Import dependencies required for the Express application
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

// Import route handlers for the main pages
var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

// Create the Express application instance
var app = express();

// Configure the view engine and views directory
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// Middleware setup
app.use(logger('dev')); // HTTP request logger
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: false })); // Parse URL-encoded request bodies
app.use(cookieParser()); // Parse cookies from incoming requests
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from /public

// Mount routes
app.use('/', indexRouter); // Home page routes
app.use('/users', usersRouter); // User-related routes

// Catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// Error handler middleware
app.use(function(err, req, res, next) {
  // Set locals for the view template
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // Respond with the error page and appropriate status code
  res.status(err.status || 500);
  res.render('error');
});

// Export the app object for use by the server entry point
module.exports = app;
