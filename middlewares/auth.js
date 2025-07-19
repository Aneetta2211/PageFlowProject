const User = require("../models/userSchema");

const userAuth = (req, res, next) => {
    if (req.session.user) {
        User.findById(req.session.user.id)
            .then(data => {
                if (data && !data.isBlocked) {
                    res.setHeader('Cache-Control', 'no-store'); 
                    req.user = data;
                    next();
                } else {
                    res.redirect("/login");
                }
            })
            .catch(error => {
                console.log("Error in user auth middleware", error);
                res.status(500).send("Internal Server error");
            });
    } else {
        res.redirect("/login");
    }
};


const adminAuth = (req, res, next) => {
    if (req.session.admin) {
        User.findOne({ isAdmin: true })
            .then(data => {
                if (data) {
                    next();
                } else {
                    res.redirect("/admin/login");
                }
            })
            .catch(error => {
                console.log("Error in adminauth middleware", error);
                res.status(500).send("Internal Server error");
            });
    } else {
        res.redirect("/admin/login");
    }
};

module.exports = {
    userAuth,
    adminAuth
};