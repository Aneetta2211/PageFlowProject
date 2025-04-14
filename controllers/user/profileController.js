const User = require("../../models/userSchema");
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
require('dotenv').config();
const session = require('express-session');

// Nodemailer transporter setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL, // Updated to match .env
        pass: process.env.EMAIL_PASSWORD, // Updated to match .env
    },
});

// 1. Render Forgot Password Page
const getForgotPasspage = async (req, res) => {
    try {
        res.render("user/forgotPassword");
    } catch (error) {
        console.error(error);
        res.redirect("/pageNotFound");
    }
};

// 2. Send OTP for Forgot Password
const forgotPassword = async (req, res) => {
    const { email } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.render("user/forgotPassword", { error: "Email not found" });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        req.session.otp = otp;
        req.session.otpEmail = email;
        req.session.otpExpires = Date.now() + 3 * 60 * 1000; // 3 minutes

        const mailOptions = {
            from: process.env.EMAIL,
            to: email,
            subject: 'Password Reset OTP',
            text: `Your OTP for password reset is: ${otp}. It expires in 3 minutes.`,
        };

        await transporter.sendMail(mailOptions);
        res.redirect("/verifyOtp");
    } catch (error) {
        console.error(error);
        res.render("user/forgotPassword", { error: "Failed to send OTP" });
    }
};

// 3. Render OTP Verification Page
const getVerifyOtpPage = async (req, res) => {
    try {
        if (!req.session.otp || !req.session.otpEmail) {
            return res.redirect("/forgotPassword");
        }
        res.render("user/forgotPassword-otp", { error: null });
    } catch (error) {
        console.error(error);
        res.redirect("/pageNotFound");
    }
};

// 4. Verify OTP
const verifyOtp = async (req, res) => {
    const { otp } = req.body;
    const storedOtp = req.session.otp;
    const email = req.session.otpEmail;
    const expires = req.session.otpExpires;

    try {
        if (!storedOtp || !email) {
            return res.redirect("/forgotPassword");
        }

        if (expires < Date.now()) {
            delete req.session.otp;
            delete req.session.otpEmail;
            delete req.session.otpExpires;
            return res.render("user/forgotPassword-otp", { error: "OTP has expired" });
        }

        if (storedOtp !== otp) {
            return res.render("user/forgotPassword-otp", { error: "Invalid OTP" });
        }

        delete req.session.otp;
        delete req.session.otpExpires;
        req.session.emailVerified = true;
        res.redirect("/resetPassword");
    } catch (error) {
        console.error(error);
        res.render("user/forgotPassword-otp", { error: "OTP verification failed" });
    }
};

// 5. Render Reset Password Page
const getResetPasswordPage = async (req, res) => {
    try {
        if (!req.session.emailVerified || !req.session.otpEmail) {
            return res.redirect("/forgotPassword");
        }
        res.render("user/resetPassword", { error: null });
    } catch (error) {
        console.error(error);
        res.redirect("/pageNotFound");
    }
};

// 6. Reset Password
const resetPassword = async (req, res) => {
    const { newPassword, confirmNewPassword } = req.body;
    const email = req.session.otpEmail;

    try {
        if (!req.session.emailVerified || !email) {
            return res.redirect("/forgotPassword");
        }
        if (newPassword !== confirmNewPassword) {
            return res.render("user/resetPassword", { error: "Passwords do not match" });
        }
        const user = await User.findOne({ email });
        if (!user) {
            return res.redirect("/forgotPassword");
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        user.password = hashedPassword;
        await user.save();
        delete req.session.otpEmail;
        delete req.session.emailVerified;
        res.redirect("/login?message=Password reset successfully");
    } catch (error) {
        console.error('Reset Password Error:', error);
        res.render("user/resetPassword", { error: "Failed to reset password" });
    }
};

// 7. Resend OTP
const resendOTP = async (req, res) => {
    const email = req.session.otpEmail;
    try {
        if (!email) {
            return res.redirect("/forgotPassword");
        }
        const user = await User.findOne({ email });
        if (!user) {
            return res.redirect("/forgotPassword");
        }
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        req.session.otp = otp;
        req.session.otpExpires = Date.now() + 3 * 60 * 1000; // 3 minutes
        const mailOptions = {
            from: process.env.EMAIL,
            to: email,
            subject: 'Password Reset OTP (Resent)',
            text: `Your new OTP for password reset is: ${otp}. It expires in 3 minutes.`,
        };
        await transporter.sendMail(mailOptions);
        res.redirect("/verifyOtp");
    } catch (error) {
        console.error(error);
        res.render("user/forgotPassword-otp", { error: "Failed to resend OTP" });
    }
};

module.exports = {
    getForgotPasspage,
    forgotPassword,
    getVerifyOtpPage,
    verifyOtp,
    getResetPasswordPage,
    resetPassword,
    resendOTP,
};