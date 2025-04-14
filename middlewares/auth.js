const User = require("../models/userSchema");



const userAuth = async (req, res, next) => {
    try {
        
        if (!req.session.user || !req.session.user.id) {
            console.log("User not logged in. Redirecting to login page.");
            return res.redirect("/login");
        }

       
        const user = await User.findById(req.session.user.id);
        if (!user) {
            console.log("User not found. Redirecting to login.");
            return res.redirect("/login");
        }

       
        if (user.isBlocked) {
            console.log("Blocked user attempted access. Redirecting to login.");
            return res.redirect("/login");
        }

        console.log("User authenticated. Proceeding to next middleware.");
        next();
    } catch (error) {
        console.error("Error in userAuth middleware:", error.message);
        res.status(500).send("Internal Server Error");
    }
};





const adminAuth = (req, res, next) => {
    if (req.session.admin && req.session.admin.id) {
        User.findById(req.session.admin.id)
            .then(admin => {
                if (admin && admin.isAdmin) {
                    next();
                } else {
                    res.redirect("/admin/login");
                }
            })
            .catch(error => {
                console.log("Error in adminAuth middleware:", error);
                res.status(500).send("Internal Server Error");
            });
    } else {
        res.redirect("/admin/login");
    }
};







module.exports={
    userAuth,
    adminAuth
}