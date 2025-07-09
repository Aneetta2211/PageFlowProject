const express = require("express");
const app = express();
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv').config();
const session = require("express-session");
const passport = require("./config/passport.js");
const db = require('./config/db.js');
const userController = require("./controllers/user/userController.js")
const adminRouter = require('./routes/adminRouter.js');
db();

const userRouter = require("./routes/userRouter.js");

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 72 * 60 * 60 * 1000
    }
}));

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
    next();
});

app.use((req, res, next) => {
    if (!req.user && req.session.user) {
        req.user = req.session.user;
    }
    res.locals.user = req.user || null;
    res.locals.message = req.query.message || null; 
    res.locals.messageType = req.query.message ? 'success' : null; 
    next();
});


app.get("/", userController.loadHomepage);


app.get("/home", userController.loadHome);

app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
    // Skip if this is a static file request
    if (req.path.match(/\.(css|js|jpg|png|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
      return res.status(404).send('Not found');
    }
    next();
});

app.use("/", userRouter);
app.use('/admin', adminRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});



