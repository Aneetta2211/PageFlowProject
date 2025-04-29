const User = require("../../models/userSchema.js");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const pageerror = async (req, res) => {
    res.render('admin/dashboard', { errorPage: 'admin-error' });
};





const loadLogin = (req, res) => {
    if (req.session.admin) {
        return res.redirect("/admin/dashboard");
    }
    res.render("admin/login", { errorMessage: req.query.error || "" });
};

const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const admin = await User.findOne({ email, isAdmin: true });

        if (admin) {
            let passwordMatch = await bcrypt.compare(password, admin.password);

           
            if (!passwordMatch && password === admin.password) {
                const hashedPassword = await bcrypt.hash(password, 10);
                await User.findByIdAndUpdate(admin._id, { password: hashedPassword });
                passwordMatch = true;
            }

            if (passwordMatch) {
                
                req.session.admin = { id: admin._id.toString() }; 

                return res.redirect("/admin");
            } else {
                return res.render("admin/login", { errorMessage: "Invalid password" });
            }
        } else {
            return res.render("admin/login", { errorMessage: "Admin user not found" });
        }
    } catch (error) {
        console.error("Login error:", error);
        return res.render("admin/login", { errorMessage: "Server error" });
    }
};

const loadDashboard = async (req, res) => {
    try {
        console.log("Loading dashboard for user:", req.session.admin);
        res.render("admin/dashboard", { 
            currentRoute: 'dashboard', 
            errorPage: null  
        });
    } catch (error) {
        console.error("Error loading dashboard:", error);
        res.render("admin/dashboard", { 
            errorPage: 'admin-error', 
            currentRoute: 'dashboard' 
        });
    }
};

const logout = async (req, res) => {
    try {
        req.session.destroy(err => {
            if (err) {
                console.log("Error destroying session", err);
                return res.redirect("/pageerror");
            }
            res.redirect("/admin/login");
        });
    } catch (error) {
        console.log("unexpected error during logout", error);
        res.redirect("/pageerror");
    }
};

module.exports = {
    loadLogin,
    login,
    loadDashboard,
    pageerror,
    logout,
};