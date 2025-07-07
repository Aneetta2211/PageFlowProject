const nodemailer = require("nodemailer");
require("dotenv").config({ path: __dirname + "/.env" }); 

const email = (process.env.EMAIL || "aneettajose1@gmail.com").trim();
const password = (process.env.EMAIL_PASSWORD || "bxgk usjd flar gtfh").trim();

if (!email || !password) {
    console.warn("EMAIL or EMAIL_PASSWORD is missing! Mailer will not be configured.");

    module.exports = null;
    return;
}

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: email,
        pass: password,
    },
});

module.exports = transporter;
