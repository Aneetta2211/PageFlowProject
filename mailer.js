const nodemailer = require("nodemailer");
require("dotenv").config(); 

const email = process.env.EMAIL;
const password = process.env.EMAIL_PASSWORD;

if (!email || !password) {
    throw new Error("EMAIL or EMAIL_PASSWORD environment variable is missing!");
}

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: email.trim(),
        pass: password.trim(),
    },
});

module.exports = transporter;