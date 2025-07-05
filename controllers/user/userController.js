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
        console.log("loadHomepage function called at", new Date().toISOString());
        console.log("Session data:", req.session);
        console.log("User session:", req.session.user);

        
        console.log("Checking database connection...");
        const dbStatus = require('mongoose').connection.readyState;
        console.log("Database connection status:", dbStatus); 

        
        console.log("Fetching available books from database...");
        const books = await Product.find({ 
            status: 'Available',
            isBlocked: false 
        })
            .limit(5)
            .lean();
        console.log(`Found ${books.length} available books:`, books);

        // Fetch categories
        console.log("Fetching categories from database...");
        const categories = await Category.find({ isListed: true })
            .lean();
        console.log(`Found ${categories.length} categories:`, categories);

        // Render landing page
        console.log("Rendering home.ejs with data...");
        res.render("user/home", { 
            isLandingPage: true,
            user: req.session.user || null,
            books: books || [],
            categories: categories || [],
            wishlistItems: { products: [] } 
        });
    } catch (error) {
        console.error("Landing Page Error:", error.message, error.stack);
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
        const { firstName, lastName, email, phone, password, confirmPassword, referralCode } = req.body;
        const name = `${firstName} ${lastName}`.trim();

        if (!name) {
            console.log("Signup Error: Name is required");
            return res.render("user/signup", { error: "Name is required" });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            console.log("Signup Error: User already exists");
            return res.render("user/signup", { error: "User already exists" });
        }

        if (phone) {
            const phonePattern = /^\d{10}$/;
            if (!phonePattern.test(phone)) {
                console.log("Signup Error: Invalid phone number");
                return res.render("user/signup", { error: "Phone number must be exactly 10 digits" });
            }
        }

        if (!password || !confirmPassword) {
            console.log("Signup Error: Password is required");
            return res.render("user/signup", { error: "Password and confirmation are required" });
        }
        if (password !== confirmPassword) {
            console.log("Signup Error: Passwords do not match");
            return res.render("user/signup", { error: "Passwords do not match" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            name,
            email,
            phone: phone || null,
            password: hashedPassword,
            referalCode: shortid.generate(),
        });

        let referrer = null;
        if (referralCode) {
            referrer = await User.findOne({ referalCode: referralCode });
            if (!referrer) {
                console.log("Signup Error: Invalid referral code");
                return res.render("user/signup", { error: "Invalid referral code" });
            }
        }

        await newUser.save();

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

        console.log("Generated OTP:", otp);
        console.log("OTP Expiration Time:", new Date(req.session.otpExpires).toLocaleTimeString());

        await transporter.sendMail({
            from: `"PAGEFLOW Support" <${process.env.EMAIL}>`,
            to: email,
            subject: "Verify Your PageFlow Account",
            text: `Your OTP for verification is: ${otp}. It will expire in 1 minute.`,
        });

        console.log("OTP sent successfully. Redirecting to OTP page...");
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
        console.log("loadHome function called at", new Date().toISOString());
        console.log("Session data:", req.session);
        console.log("User session:", req.session.user);

        if (!req.session.user) {
            console.log("User not logged in, redirecting to /login");
            return res.redirect("/login?message=Please log in to view the homepage");
        }

        console.log("Checking database connection...");
        const dbStatus = require('mongoose').connection.readyState;
        console.log("Database connection status:", dbStatus);

        console.log("Fetching all products from database...");
        const allProducts = await Product.find({}).lean();
        console.log(`Found ${allProducts.length} total products:`, allProducts);

        console.log("Fetching available books from database...");
        const books = await Product.find({ 
            status: 'Available',
            isBlocked: false 
        })
            .limit(5)
            .lean();
        console.log(`Found ${books.length} available books:`, books);

        console.log("Fetching categories from database...");
        const categories = await Category.find({ isListed: true })
            .lean();
        console.log(`Found ${categories.length} categories:`, categories);

        console.log("Fetching wishlist for user:", req.session.user.id);
        const wishlist = await Wishlist.findOne({ userId: req.session.user.id }).lean() || { products: [] };
        console.log("Wishlist items:", wishlist);

        console.log("Rendering home.ejs with data...");
        res.render("user/home", { 
            isLandingPage: false,
            user: req.session.user,
            books: books || [],
            categories: categories || [],
            wishlistItems: wishlist
        });
    } catch (error) {
        console.error("Home Page Error:", error.message, error.stack);
        res.status(500).send(`Server Error: Unable to load homepage - ${error.message}`);
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