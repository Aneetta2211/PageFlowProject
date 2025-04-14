
const User=require("../../models/userSchema");
const env=require('dotenv').config();
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const transporter = require("../../mailer"); 


const pageNotFound = async (req, res) => {
    try {
        res.render("user/page-404")  // Add 'user/' before page-404
    } catch (error) {
        res.redirect("/pageNotFound")
    }
}


const loadHomepage = async (req, res) => {
    try {
        return res.render("user/home", { isLandingPage: true, user: req.user });
    } catch (error) {
        console.log("home page not found", error);
        res.status(500).send("server error");
    }
};




const loadSignup = async (req, res) => {
    try {
        res.render("user/signup", { error: null }); //  Load signup.ejs
    } catch (error) {
        console.error("Signup Page Error:", error);
        res.status(500).send("Server Error");
    }
};



// Function to generate OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const registerUser = async (req, res) => {
    try {
      const { firstName, lastName, email, phone, password, confirmPassword } = req.body;
      const name = `${firstName} ${lastName}`.trim();
  
      // Validate name (required)
      if (!name) {
        console.log("Signup Error: Name is required");
        return res.render("user/signup", { error: "Name is required" });
      }
  
      // Validate email (required and unique)
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        console.log("Signup Error: User already exists");
        return res.render("user/signup", { error: "User already exists" });
      }
  
      // Validate phone (optional, but if provided, must be 10 digits and numeric)
      if (phone) {
        const phonePattern = /^\d{10}$/; // Matches exactly 10 digits
        if (!phonePattern.test(phone)) {
          console.log("Signup Error: Invalid phone number");
          return res.render("user/signup", { error: "Phone number must be exactly 10 digits" });
        }
      }
  
      // Validate password and confirmPassword match (required for non-Google signup)
      if (!password || !confirmPassword) {
        console.log("Signup Error: Password is required");
        return res.render("user/signup", { error: "Password and confirmation are required" });
      }
      if (password !== confirmPassword) {
        console.log("Signup Error: Passwords do not match");
        return res.render("user/signup", { error: "Passwords do not match" });
      }
  
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
  
      // Create new user (phone is optional, defaults to null if not provided)
      const newUser = new User({
        name,
        email,
        phone: phone || null, // Set to null if not provided
        password: hashedPassword,
      });
      await newUser.save();
  
      // Generate OTP and store in session
      const otp = generateOTP();
      req.session.otp = otp;
      req.session.otpEmail = email;
      req.session.otpExpires = Date.now() + 3 * 60 * 1000;
  
      console.log("Generated OTP:", otp);
      console.log("OTP Expiration Time:", new Date(req.session.otpExpires).toLocaleTimeString());
  
      // Send OTP email
      await transporter.sendMail({
        from: `"PAGEFLOW Support" <${process.env.EMAIL}>`,
        to: email,
        subject: "Verify Your PageFlow Account",
        text: `Your OTP for verification is: ${otp}. It will expire in 3 minutes.`,
      });
  
      console.log("OTP sent successfully. Redirecting to OTP page...");
      return res.render("user/verify-otp", { error: null, email });
  
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

    if (!storedOTP || !email) {
        return res.render("user/verify-otp", { error: "OTP expired! Please request a new one.", email });
    }

    if (otp !== storedOTP) {
        return res.render("user/verify-otp", { error: "Invalid OTP. Please try again.", email });
    }

    // Clear OTP session
    req.session.otp = null;
    req.session.otpEmail = null;
    req.session.otpExpires = null;

    console.log("OTP verified! Redirecting to login...");
    
    // Add this line right here, before the redirect
    console.log("About to redirect to login page");
    return res.redirect("/login?message=OTP verified! Please log in.");

} catch (error) {
    console.error("OTP Verification Error:", error);
    return res.status(500).send("Internal Server Error");
}
};

const resendOTP = async (req, res) => {
try {
    if (!req.session.otpEmail) {
        return res.redirect("/signup"); // Redirect to signup if no email is stored
    }

    //  Invalidate old OTP before generating a new one
    req.session.otp = null;
    req.session.otpExpires = null;

    //  Generate a new OTP
    const otp = generateOTP();
    req.session.otp = otp;
    req.session.otpExpires = Date.now() + 3 * 60 * 1000; // Set new expiration (3 minutes)

    console.log("New OTP sent:", otp);

    await transporter.sendMail({
        from: `"PAGEFLOW Support" <aneettajose1@gmail.com>`,
        to: req.session.otpEmail,
        subject: "Resend OTP for PageFlow",
        text: `Your new OTP is: ${otp}. It will expire in 3 minutes.`,
    });

    res.render("user/verify-otp", { error: "A new OTP has been sent!", email: req.session.otpEmail });

} catch (error) {
    console.error("Resend OTP Error:", error);
    res.status(500).send("Internal Server Error");
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

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        return res.render("user/login", { message: "Invalid email or password!" });
    }

    // Store user session
    req.session.user = {
        id: user._id,
        name: user.name,
        email: user.email
    };

    // Redirect to home page after login
    res.redirect("/home");

} catch (error) {
    console.error("Login Error:", error);
    return res.render("user/login", { message: "Something went wrong. Please try again!" });
}
};


const loadHome = async (req, res) => {
try {
    //  Check if the user is logged in
    if (!req.session.user) {
        return res.redirect("/login"); // Redirect to login if not logged in
    }

    res.render("user/home", { user: req.session.user }); //  Pass user data to home.ejs

} catch (error) {
    console.error("Home Page Error:", error);
    res.status(500).send("Server Error");
}
};

const logout=async (req,res)=>{
try {

    req.session.destroy((err)=>{
       if(err){
        console.log("session destruction error",err.message);
        return res.redirect("/pageNotFound")
       }
       return res.redirect("/login")
    })
    
} catch (error) {

    console.log("Logout error",error);
    res.redirect("/pageNotFound");
    
    
}
}




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

};
