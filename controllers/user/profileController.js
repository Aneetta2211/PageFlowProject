const User = require("../../models/userSchema");
const Address = require("../../models/addressSchema");
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
require('dotenv').config();
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const mongoose=require('mongoose');

// Nodemailer transporter configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASSWORD,
    },
});

// Generate OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Forgot Password Functions
const getForgotPasspage = async (req, res) => {
    try {
        res.render("user/forgotPassword");
    } catch (error) {
        console.error('Error loading forgot password page:', error);
        res.redirect("/pageNotFound");
    }
};

const forgotPassword = async (req, res) => {
    const { email } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.render("user/forgotPassword", { error: "Email not found" });
        }

        const otp = generateOTP();
        req.session.otp = otp.toString();
        req.session.otpEmail = email;
        req.session.otpExpires = Date.now() + 3 * 60 * 1000;

        const mailOptions = {
            from: process.env.EMAIL,
            to: email,
            subject: 'Password Reset OTP',
            text: `Your OTP for password reset is: ${otp}. It expires in 3 minutes.`,
        };

        await transporter.sendMail(mailOptions);
        console.log(`Forgot password OTP sent to ${email}: ${otp}`);

        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.render("user/forgotPassword", { error: "Failed to process request" });
            }
            res.redirect("/verifyOtp");
        });
    } catch (error) {
        console.error('Error sending forgot password OTP:', error);
        res.render("user/forgotPassword", { error: "Failed to send OTP" });
    }
};

const getVerifyOtpPage = async (req, res) => {
    try {
        if (!req.session.otp || !req.session.otpEmail) {
            return res.redirect("/forgotPassword");
        }
        res.render("user/forgotPassword-otp", { error: null });
    } catch (error) {
        console.error('Error loading OTP verification page:', error);
        res.redirect("/pageNotFound");
    }
};

const verifyOtp = async (req, res) => {
    const { otp } = req.body;
    const cleanOtp = otp ? otp.toString().trim() : '';
    const storedOtp = req.session.otp ? req.session.otp.toString() : '';
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

        if (storedOtp !== cleanOtp) {
            return res.render("user/forgotPassword-otp", { error: "Invalid OTP" });
        }

        delete req.session.otp;
        delete req.session.otpExpires;
        req.session.emailVerified = true;

        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.render("user/forgotPassword-otp", { error: "Verification failed" });
            }
            res.redirect("/resetPassword");
        });
    } catch (error) {
        console.error('Error verifying OTP:', error);
        res.render("user/forgotPassword-otp", { error: "OTP verification failed" });
    }
};

const getResetPasswordPage = async (req, res) => {
    try {
        if (!req.session.emailVerified || !req.session.otpEmail) {
            return res.redirect("/forgotPassword");
        }
        res.render("user/resetPassword", { error: null });
    } catch (error) {
        console.error('Error loading reset password page:', error);
        res.redirect("/pageNotFound");
    }
};

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
        const otp = generateOTP();
        req.session.otp = otp.toString();
        req.session.otpExpires = Date.now() + 3 * 60 * 1000;
        const mailOptions = {
            from: process.env.EMAIL,
            to: email,
            subject: 'Password Reset OTP (Resent)',
            text: `Your new OTP for password reset is: ${otp}. It expires in 3 minutes.`,
        };
        await transporter.sendMail(mailOptions);
        console.log(`Resent forgot password OTP to ${email}: ${otp}`);

        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.render("user/forgotPassword-otp", { error: "Failed to resend OTP" });
            }
            res.redirect("/verifyOtp");
        });
    } catch (error) {
        console.error('Error resending forgot password OTP:', error);
        res.render("user/forgotPassword-otp", { error: "Failed to resend OTP" });
    }
};



// In your getProfilePage function:
const getProfilePage = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const user = await User.findById(userId).select('-password');
        
        // Pass any error/success messages from query params
        const error = req.query.error;
        const success = req.query.success;
        
        res.render('user/profile', {
            user,
            editMode: req.query.edit === 'true',
            title: req.query.edit === 'true' ? 'Edit Profile' : 'My Profile',
            messages: { error, success }
        });
    } catch (error) {
        console.error('Profile Page Error:', error);
        res.redirect('/home');
    }
};

// Edit Profile Page
const getEditProfilePage = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const user = await User.findById(userId).select('-password');
        
        res.render('user/edit-profile', {
            user,
            title: 'Edit Profile'
        });
    } catch (error) {
        console.error('Edit Profile Error:', error);
        res.redirect('/profile');
    }
};

// In your profileController.js
const sendOtpForEmail = async (req, res) => {
    try {
        const { email } = req.body;
        const otp = generateOTP();
        
        // Log OTP to console (for development only)
        console.log(`OTP for ${email}: ${otp}`);
        
        // Save OTP to session/database
        req.session.emailChange = {
            newEmail: email,
            otp,
            expires: Date.now() + 60000
        };
        
        // Send email (your existing code)
        
        res.json({ 
            success: true,
            otp // Only include this for development
        });
    } catch (error) {
        console.error('Send OTP Error:', error);
        res.json({ success: false, message: 'Failed to send OTP' });
    }
};

// Update your verifyEmailChangeOtp function
const verifyEmailChangeOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;
        
        if (!req.session.emailChange || 
            req.session.emailChange.newEmail !== email ||
            req.session.emailChange.otp !== otp ||
            req.session.emailChange.expires < Date.now()) {
            return res.json({ 
                success: false, 
                message: 'Invalid or expired OTP' 
            });
        }
        
        // Check if email already exists
        const existingUser = await User.findOne({ email });
        if (existingUser && existingUser._id.toString() !== req.session.user.id) {
            return res.json({ 
                success: false, 
                message: 'Email already in use by another account'
            });
        }
        
        // Mark email as verified
        req.session.emailChange.verified = true;
        req.session.save(err => {
            if (err) {
                console.error('Session save error:', err);
                return res.json({ 
                    success: false, 
                    message: 'Failed to verify email' 
                });
            }
            res.json({ success: true });
        });
    } catch (error) {
        console.error('Verify OTP Error:', error);
        res.json({ 
            success: false, 
            message: 'Failed to verify OTP' 
        });
    }
};
// Resend OTP
const resendOtp = async (req, res) => {
    try {
        const { email } = req.body;
        const userId = req.session.user.id;
        
        if (!req.session.emailChange || req.session.emailChange.newEmail !== email) {
            return res.json({ success: false, message: 'Invalid request' });
        }
        
        const otp = generateOTP();
        req.session.emailChange = {
            newEmail: email,
            otp,
            expires: Date.now() + 60000 // 1 minute
        };
        
        // Send OTP via email
        const mailOptions = {
            from: process.env.EMAIL,
            to: email,
            subject: 'Email Change OTP (Resent)',
            text: `Your new OTP for email change is: ${otp}. It expires in 1 minute.`
        };
        
        await transporter.sendMail(mailOptions);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Resend OTP Error:', error);
        res.json({ success: false, message: 'Failed to resend OTP' });
    }
};

// Update Profile
// Update your updateProfile function like this:
const updateProfile = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { name, phone, currentPassword, newPassword, confirmPassword, otp } = req.body;
        
        const user = await User.findById(userId);
        
        // Update basic info
        user.name = name || user.name;
        user.phone = phone || user.phone;
        
        // Handle profile image upload
        if (req.file) {
            // Remove old profile image if exists
            if (user.profileImage && user.profileImage !== '/images/default-profile.png') {
                const oldImagePath = path.join(__dirname, '../../public', user.profileImage);
                if (fs.existsSync(oldImagePath)) {
                    fs.unlinkSync(oldImagePath);
                }
            }
            user.profileImage = '/uploads/profile/' + req.file.filename;
        } else if (req.body.removeProfileImage === 'true') {
            // Remove profile image if requested
            if (user.profileImage && user.profileImage !== '/images/default-profile.png') {
                const oldImagePath = path.join(__dirname, '../../public', user.profileImage);
                if (fs.existsSync(oldImagePath)) {
                    fs.unlinkSync(oldImagePath);
                }
            }
            user.profileImage = '/images/default-profile.png';
        }
        
        // Handle email change if OTP is verified
        if (req.session.emailChange?.verified && req.session.emailChange.newEmail) {
            user.email = req.session.emailChange.newEmail;
            delete req.session.emailChange;
        }
        
        // Handle password change only if current password is provided
        if (currentPassword) {
            const isMatch = await bcrypt.compare(currentPassword, user.password);
            if (!isMatch) {
                return res.redirect('/profile?edit=true&error=Current password is incorrect');
            }
            
            if (newPassword !== confirmPassword) {
                return res.redirect('/profile?edit=true&error=New passwords do not match');
            }
            
            if (newPassword.length < 8) {
                return res.redirect('/profile?edit=true&error=Password must be at least 8 characters');
            }
            
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(newPassword, salt);
        }
        
        await user.save();
        res.redirect('/profile?success=Profile updated successfully');
    } catch (error) {
        console.error('Update Profile Error:', error);
        res.redirect('/profile?edit=true&error=Failed to update profile');
    }
};

// Address Controller Functions
const getAddressesPage = async (req, res) => {
    try {
        console.log("Entered getAddressesPage controller");
        const userId = req.session.user?.id;
        console.log("User ID:", userId);
        
        if (!userId) {
            console.log("No user ID - redirecting to login");
            return res.redirect('/login');
        }
        
        // Fetch the user
        const user = await User.findById(userId);
        if (!user) {
            console.log("User not found");
            return res.redirect('/login');
        }
        
        // Fetch the address document for the user
        const addressDoc = await Address.findOne({ userId });
        console.log("Address data:", addressDoc);
        
        res.render('user/addresses', {
            user,
            showForm: false,
            addresses: { address: addressDoc?.address || [] }, // Pass the address array or empty array
            title: 'My Addresses',
            currentPage: 'addresses'
        });
    } catch (error) {
        console.error('Address Page Error:', error);
        res.redirect('/profile?error=Failed to load addresses');
    }
};
const getAddAddressPage = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const user = await User.findById(userId);

        res.render('user/addresses', {
            user,
            showForm: true,
            editMode: false,
            title: 'Add New Address'
        });
    } catch (error) {
        console.error('Add Address Page Error:', error);
        res.redirect('/profile/addresses?error=Failed to load address form');
    }
};

const getEditAddressPage = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const addressId = req.params.id;

        const user = await User.findById(userId);
        const addressDoc = await Address.findOne({ userId, "address._id": addressId });

        if (!addressDoc) {
            return res.redirect('/profile/addresses?error=Address not found');
        }

        // Find the specific address in the array
        const address = addressDoc.address.find(addr => addr._id.toString() === addressId);

        if (!address) {
            return res.redirect('/profile/addresses?error=Address not found');
        }

        res.render('user/addresses', {
            user,
            address, // Pass the specific address object
            showForm: true,
            editMode: true,
            title: 'Edit Address'
        });
    } catch (error) {
        console.error('Edit Address Page Error:', error);
        res.redirect('/profile/addresses?error=Failed to load address form');
    }
};
const addAddress = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const {
            addressType,
            name,
            city,
            landMark,
            state,
            pincode,
            phone,
            altPhone
        } = req.body;
        
        // Basic validation
        if (!addressType || !name || !city || !landMark || !state || !pincode || !phone) {
            return res.redirect('/profile/addresses/add?error=Please fill all required fields');
        }
        
        // Validate pincode
        if (!/^\d{6}$/.test(pincode)) {
            return res.redirect('/profile/addresses/add?error=Invalid pincode');
        }
        
        // Validate phone numbers
        if (!/^\d{10}$/.test(phone)) {
            return res.redirect('/profile/addresses/add?error=Invalid phone number');
        }
        
        if (altPhone && !/^\d{10}$/.test(altPhone)) {
            return res.redirect('/profile/addresses/add?error=Invalid alternate phone number');
        }
        
        // Find or create the user's address document
        let addressDoc = await Address.findOne({ userId });
        
        const newAddress = {
            addressType,
            name,
            city,
            landMark,
            state,
            pincode: Number(pincode), // Ensure pincode is stored as a number
            phone,
            altPhone
        };
        
        if (addressDoc) {
            // Add to existing address array
            addressDoc.address.push(newAddress);
            await addressDoc.save();
        } else {
            // Create new address document
            addressDoc = new Address({
                userId,
                address: [newAddress]
            });
            await addressDoc.save();
        }
        
        res.redirect('/profile/addresses?success=Address added successfully');
    } catch (error) {
        console.error('Add Address Error:', error);
        res.redirect('/profile/addresses/add?error=Failed to add address');
    }
};

const updateAddress = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const addressId = req.params.id; // This is the _id of the address object in the array
        const {
            addressType,
            name,
            city,
            landMark,
            state,
            pincode,
            phone,
            altPhone
        } = req.body;
        
        // Basic validation
        if (!addressType || !name || !city || !landMark || !state || !pincode || !phone) {
            return res.redirect(`/profile/addresses/edit/${addressId}?error=Please fill all required fields`);
        }
        
        // Validate pincode
        if (!/^\d{6}$/.test(pincode)) {
            return res.redirect(`/profile/addresses/edit/${addressId}?error=Invalid pincode`);
        }
        
        // Validate phone numbers
        if (!/^\d{10}$/.test(phone)) {
            return res.redirect(`/profile/addresses/edit/${addressId}?error=Invalid phone number`);
        }
        
        if (altPhone && !/^\d{10}$/.test(altPhone)) {
            return res.redirect(`/profile/addresses/edit/${addressId}?error=Invalid alternate phone number`);
        }
        
        // Update the specific address in the address array
        const addressDoc = await Address.findOneAndUpdate(
            { userId, "address._id": addressId },
            {
                $set: {
                    "address.$.addressType": addressType,
                    "address.$.name": name,
                    "address.$.city": city,
                    "address.$.landMark": landMark,
                    "address.$.state": state,
                    "address.$.pincode": Number(pincode),
                    "address.$.phone": phone,
                    "address.$.altPhone": altPhone
                }
            },
            { new: true }
        );
        
        if (!addressDoc) {
            return res.redirect('/profile/addresses?error=Address not found');
        }
        
        res.redirect('/profile/addresses?success=Address updated successfully');
    } catch (error) {
        console.error('Update Address Error:', error);
        res.redirect(`/profile/addresses/edit/${req.params.id}?error=Failed to update address`);
    }
};
const deleteAddress = async (req, res) => {
    try {
        // Validate session
        if (!req.session.user || !req.session.user.id) {
            return res.status(401).json({ success: false, message: 'User not authenticated' });
        }

        const userId = req.session.user.id;
        const addressId = req.params.id;

        // Validate addressId as ObjectId
        if (!mongoose.Types.ObjectId.isValid(addressId)) {
            return res.status(400).json({ success: false, message: 'Invalid address ID' });
        }

        // Remove the specific address from the address array
        const addressDoc = await Address.findOneAndUpdate(
            { userId },
            { $pull: { address: { _id: addressId } } },
            { new: true }
        );

        if (!addressDoc) {
            return res.status(404).json({ success: false, message: 'Address not found' });
        }

        res.json({ success: true, message: 'Address deleted successfully' });
    } catch (error) {
        console.error('Delete Address Error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete address', error: error.message });
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
    getProfilePage,
    getEditProfilePage,
    updateProfile,
    sendOtpForEmail,
    verifyEmailChangeOtp,
    resendOtp,
    getAddressesPage,
    getAddAddressPage,
    getEditAddressPage,
    addAddress,
    updateAddress,
    deleteAddress
    
    
};