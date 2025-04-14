const nodemailer = require("nodemailer");
require("dotenv").config(); 

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL.trim(), 
        pass: process.env.EMAIL_PASSWORD.trim(), 
    },
});


module.exports = transporter; // Export the transporter
