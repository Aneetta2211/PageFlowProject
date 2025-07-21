const mongoose = require('mongoose');
const User = require("../../models/userSchema");
const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const Wishlist = require("../../models/wishlistSchema");
const Wallet = require("../../models/walletSchema");
const { addToWallet } = require("../user/walletController");
const env = require('dotenv').config();
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const transporter = require("../../mailer"); 
const shortid = require("shortid");

const pageNotFound = async (req, res) => {
    try {
        res.render("user/page-404");
    } catch (error) {
        res.redirect("/pageNotFound");
    }
};

const loadHomepage = async (req, res) => {
    try {
        const books = await Product.find({ 
            status: 'Available',
            isBlocked: false 
        }).limit(5).lean();

        const categories = await Category.find({ isListed: true }).lean();

        let wishlistItems = { products: [] };
        if (req.session.user) {
            wishlistItems = await Wishlist.findOne({ userId: req.session.user.id })
                .populate('products.productId')
                .lean() || { products: [] };
        }

        res.render("user/home", { 
            isLandingPage: true,
            user: req.session.user || null,
            books,
            categories,
            wishlistItems 
        });
    } catch (error) {
        console.error("Landing Page Error:", error.message);
        res.status(500).send(`Server Error: Unable to load landing page - ${error.message}`);
    }
};

const loadSignup = async (req, res) => {
    try {
        res.render("user/signup", { error: null }); 
    } catch (error) {
        console.error("Signup Page Error:", error);
        res.status(500).send("Server Error");
    }
};

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const registerUser = async (req, res) => {
    try {
        const { firstName, lastName, email: rawEmail, phone, password, confirmPassword, referralCode } = req.body;
        const name = `${firstName} ${lastName}`.trim();
        const email = rawEmail.trim().toLowerCase();

        if (!name) return res.render("user/signup", { error: "Name is required" });

        const existingUser = await User.findOne({ email });
        if (existingUser) return res.render("user/signup", { error: "Email already registered" });

        if (phone) {
            const phonePattern = /^\d{10}$/;
            if (!phonePattern.test(phone)) {
                return res.render("user/signup", { error: "Phone number must be exactly 10 digits" });
            }
        }

        if (!password || !confirmPassword) {
            return res.render("user/signup", { error: "Password and confirmation are required" });
        }

        if (password !== confirmPassword) {
            return res.render("user/signup", { error: "Passwords do not match" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        let referalCode, isUnique = false;
        for (let i = 0; i < 5; i++) {
            referalCode = shortid.generate();
            const existingCode = await User.findOne({ referalCode });
            if (!existingCode) {
                isUnique = true;
                break;
            }
        }

        if (!isUnique) {
            return res.render("user/signup", { error: "Something went wrong. Try again later." });
        }

        let referrer = null;
        if (referralCode) {
            referrer = await User.findOne({ referalCode: referralCode });
            if (!referrer) {
                return res.render("user/signup", { error: "Invalid referral code" });
            }
        }

        let newUser;
        let saved = false;
        for (let i = 0; i < 3 && !saved; i++) {
            try {
                newUser = new User({
                    name,
                    email,
                    phone: phone || null,
                    password: hashedPassword,
                    referalCode,
                });
                await newUser.save();
                saved = true;
            } catch (err) {
                if (err.code === 11000 && err.keyPattern?.referalCode) {
                    referalCode = shortid.generate(); // Retry with a new referral code
                    continue;
                }
                if (err.code === 11000 && err.keyPattern?.email) {
                    return res.render("user/signup", { error: "Email already registered" });
                }
                throw err;
            }
        }

        if (!saved) {
            return res.render("user/signup", { error: "Failed to register user. Please try again." });
        }

        if (referrer) {
            await addToWallet({
                userId: newUser._id,
                amount: 50,
                description: `Referral bonus for signing up with code ${referralCode}`,
            });

            await addToWallet({
                userId: referrer._id,
                amount: 50,
                description: `Referral bonus for referring ${newUser.email}`,
            });

            referrer.redeemedUsers.push(newUser._id);
            await referrer.save();
        }

        const otp = generateOTP();
        req.session.otp = otp;
        req.session.otpEmail = email;
        req.session.otpExpires = Date.now() + 1 * 60 * 1000;

        await transporter.sendMail({
            from: `"PAGEFLOW Support" <${process.env.EMAIL}>`,
            to: email,
            subject: "Verify Your PageFlow Account",
            text: `Your OTP for verification is: ${otp}. It will expire in 1 minute.`,
        });

        return res.render("user/verify-otp", {
            error: null,
            email,
            otpExpires: req.session.otpExpires,
        });

    } catch (error) {
        console.error("Signup Error:", error);
        return res.status(500).send("Internal Server Error");
    }
};



const verifyOTP = async (req, res) => {
    try {
        const { otp } = req.body;
        const storedOTP = req.session.otp;
        const email = req.session.otpEmail;
        const otpExpires = req.session.otpExpires;

        if (!storedOTP || !email || !otpExpires) {
            return res.render("user/verify-otp", { error: "OTP expired! Please request a new one.", email });
        }

        if (Date.now() > otpExpires) {
            req.session.otp = null;
            req.session.otpEmail = null;
            req.session.otpExpires = null;
            return res.render("user/verify-otp", { error: "OTP expired! Please request a new one.", email });
        }

        if (otp !== storedOTP) {
            return res.render("user/verify-otp", {
                error: "Invalid OTP. Please try again.",
                email,
                otpExpires: req.session.otpExpires
            });
        }

        req.session.otp = null;
        req.session.otpEmail = null;
        req.session.otpExpires = null;

        console.log("OTP verified! Redirecting to login...");
        return res.redirect("/login?message=OTP verified! Please log in.");
    } catch (error) {
        console.error("OTP Verification Error:", error);
        return res.status(500).send("Internal Server Error");
    }
};

const resendOTP = async (req, res) => {
    try {
        if (!req.session.otpEmail) {
            return res.redirect("/signup");
        }

        req.session.otp = null;
        req.session.otpExpires = null;

        const otp = generateOTP();
        req.session.otp = otp;
        req.session.otpExpires = Date.now() + 1 * 60 * 1000;

        console.log("New OTP sent:", otp);

        await transporter.sendMail({
            from: `"PAGEFLOW Support" <aneettajose1@gmail.com>`,
            to: req.session.otpEmail,
            subject: "Resend OTP for PageFlow",
            text: `Your new OTP is: ${otp}. It will expire in 1 minute.`,
        });

        res.render("user/verify-otp", {
            error: "A new OTP has been sent!",
            email: req.session.otpEmail,
            otpExpires: req.session.otpExpires
        });
    } catch (error) {
        console.error("Resend OTP Error:", error);
        return res.status(500).send("Internal Server Error");
    }
};

const loadLogin = async (req, res) => {
    try {
        const message = req.query.message || null;
        res.render("user/login", { error: null, message });
    } catch (error) {
        console.error("Login Page Error:", error);
        res.status(500).send("Server Error");
    }
};

const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            return res.render("user/login", { message: "Invalid email or password!" });
        }
        if (user.isBlocked) {
            return res.render("user/login", { message: "Your account is blocked. Please contact support." });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.render("user/login", { message: "Invalid email or password!" });
        }
        req.session.user = {
            id: user._id,
            name: user.name,
            email: user.email
        };
        console.log("User logged in:", user.email, "isBlocked:", user.isBlocked);
        res.redirect("/home");
    } catch (error) {
        console.error("Login Error:", error);
        return res.render("user/login", { message: "Something went wrong. Please try again!" });
    }
};

const loadHome = async (req, res) => {
    try {
        if (!req.session.user) {
            return res.redirect('/login?message=Please log in to view the homepage');
        }

        const books = await Product.find({ 
            status: 'Available',
            isBlocked: false 
        }).limit(5).lean();

        const categories = await Category.find({ isListed: true }).lean();

        // Properly initialize wishlist
        let wishlist = await Wishlist.findOne({ userId: req.session.user.id })
            .populate('products.productId')
            .lean() || { products: [] };

        res.render("user/home", { 
            isLandingPage: false,
            user: req.session.user,
            books: books || [],
            categories: categories || [],
            wishlistItems: wishlist
        });
    } catch (error) {
        console.error("Home Page Error:", error);
        res.status(500).send(`Server Error: ${error.message}`);
    }
};

const logout = async (req, res) => {
    try {
        req.session.destroy((err) => {
            if (err) {
                console.log("session destruction error", err.message);
                return res.redirect("/pageNotFound");
            }
            return res.redirect("/login");
        });
    } catch (error) {
        console.log("Logout error", error);
        res.redirect("/pageNotFound");
    }
};

const loadAbout = async (req, res) => {
    try {
        const user = req.session.user || null;
        res.render("user/about", { 
            user: user,
            title: "About Us - Our Story",
            currentPage: "about"
        });
    } catch (error) {
        console.error("About Page Error:", error);
        res.status(500).send("Server Error");
    }
};

const loadContact = async (req, res) => {
    try {
        const user = req.session.user || null;
        res.render("user/contact", { 
            user: user,
            title: "Contact Us - PageFlow",
            currentPage: "contact"
        });
    } catch (error) {
        console.error("Contact Page Error:", error);
        res.status(500).send("Server Error");
    }
};

module.exports = {
    pageNotFound,
    loadHomepage,
    registerUser,
    loadSignup,
    loadLogin,
    loadHome,
    loginUser,
    verifyOTP,
    resendOTP,
    logout,
    loadAbout, 
    loadContact
};