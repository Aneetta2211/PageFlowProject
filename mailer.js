require("dotenv").config();

const email = process.env.EMAIL;
const password = process.env.EMAIL_PASSWORD;

if (!email || !password) {
    console.error(" Missing EMAIL or EMAIL_PASSWORD in environment variables.");
    process.exit(1);
}

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: email.trim(),
        pass: password.trim(),
    },
});

module.exports = transporter;
