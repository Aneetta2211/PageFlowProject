const User = require("../../models/userSchema");
const Address = require("../../models/addressSchema");
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const env = require('dotenv').config();
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Nodemailer transporter configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASSWORD,
    },
});

const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

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

const getProfilePage = async (req, res) => {
    try {
        if (!req.session.user || !req.session.user.id) {
            return res.redirect('/login');
        }

        const userId = req.session.user.id;
        const user = await User.findById(userId).select('-password');
        
        if (!user) {
            req.session.destroy();
            return res.redirect('/login?error=User not found');
        }
        
        
        if (user.profileImage && !user.profileImage.startsWith('/uploads/profile/') && 
            user.profileImage !== '/images/default-profile.png') {
            user.profileImage = `/uploads/profile/${path.basename(user.profileImage)}`;
            await user.save();
        }

        res.render('user/profile', {
            user,
            editMode: req.query.edit === 'true',
            title: req.query.edit === 'true' ? 'Edit Profile' : 'My Profile',
            messages: { 
                error: req.query.error || null, 
                success: req.query.success || null 
            }
        });
    } catch (error) {
        console.error('Profile Page Error:', error);
        res.redirect('/home?error=Failed to load profile');
    }
};

const getEditProfilePage = async (req, res) => {
    try {
        if (!req.session.user || !req.session.user.id) {
            return res.redirect('/login');
        }

        const userId = req.session.user.id;
        const user = await User.findById(userId).select('-password');
        
        if (!user) {
            req.session.destroy();
            return res.redirect('/login?error=User not found');
        }
        
       
        if (user.profileImage && !user.profileImage.startsWith('/uploads/profile/') && 
            user.profileImage !== '/images/default-profile.png') {
            user.profileImage = `/uploads/profile/${path.basename(user.profileImage)}`;
            await user.save();
        }

        res.render('user/profile', {
            user,
            editMode: true,
            title: 'Edit Profile',
            messages: { 
                error: req.query.error || null, 
                success: req.query.success || null 
            }
        });
    } catch (error) {
        console.error('Edit Profile Error:', error);
        res.redirect('/profile?error=Failed to load edit profile page');
    }
};

const sendOtpForEmail = async (req, res) => {
    try {
        console.log('Received send-otp request:', req.body);
        if (!req.session.user || !req.session.user.id) {
            console.log('Authentication failed: No user session');
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        const { email } = req.body;
        console.log('Processing email:', email);
        
        if (!email) {
            console.log('Email missing in request');
            return res.status(400).json({ success: false, message: 'Email is required' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            console.log('Invalid email format:', email);
            return res.status(400).json({ success: false, message: 'Invalid email format' });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser && existingUser._id.toString() !== req.session.user.id) {
            console.log('Email already in use:', email);
            return res.status(400).json({ success: false, message: 'Email already in use by another account' });
        }
        
        const otp = generateOTP();
        console.log('Generated OTP:', otp);
        
        req.session.emailChange = {
            newEmail: email,
            otp: otp.toString(),
            expires: Date.now() + 120 * 1000 
        };
        
        await new Promise((resolve, reject) => {
            req.session.save(err => {
                if (err) {
                    console.error('Session save error in sendOtpForEmail:', err);
                    reject(new Error('Failed to save session'));
                } else {
                    console.log('Session saved successfully');
                    resolve();
                }
            });
        });
        
        const mailOptions = {
            from: process.env.EMAIL,
            to: email,
            subject: 'Email Verification OTP',
            text: `Your OTP to verify your new email is: ${otp}. It expires in 2 minutes.`
        };
        
        await transporter.sendMail(mailOptions);
        console.log(`Email verification OTP sent to ${email}: ${otp}`);
        
        res.json({ 
            success: true,
            message: 'OTP sent to your new email'
        });
    } catch (error) {
        console.error('Send OTP Error:', error);
        res.status(500).json({ success: false, message: 'Failed to send OTP' });
    }
};

const verifyEmailChangeOtp = async (req, res) => {
    try {
        if (!req.session.user || !req.session.user.id) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        const { email, otp } = req.body;
        
        if (!email || !otp) {
            return res.status(400).json({ success: false, message: 'Email and OTP are required' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ success: false, message: 'Invalid email format' });
        }
        
        if (!req.session.emailChange) {
            return res.status(400).json({ success: false, message: 'No email change requested' });
        }
        
        if (req.session.emailChange.newEmail !== email) {
            return res.status(400).json({ success: false, message: 'Email does not match the requested email' });
        }
        
        if (req.session.emailChange.otp !== otp.toString().trim()) {
            return res.status(400).json({ success: false, message: 'Invalid OTP' });
        }
        
        if (req.session.emailChange.expires < Date.now()) {
            delete req.session.emailChange;
            await new Promise((resolve, reject) => {
                req.session.save(err => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            return res.status(400).json({ success: false, message: 'OTP has expired' });
        }
        
        req.session.emailChange.verified = true;
        
        await new Promise((resolve, reject) => {
            req.session.save(err => {
                if (err) {
                    console.error('Session save error in verifyEmailChangeOtp:', err);
                    reject(new Error('Failed to save session'));
                } else {
                    resolve();
                }
            });
        });
        
        res.json({ success: true, message: 'Email verified successfully' });
    } catch (error) {
        console.error('Verify OTP Error:', error);
        res.status(500).json({ success: false, message: 'Failed to verify OTP' });
    }
};

const resendOtp = async (req, res) => {
    try {
        if (!req.session.user || !req.session.user.id) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ success: false, message: 'Invalid email format' });
        }
        
        const existingUser = await User.findOne({ email });
        if (existingUser && existingUser._id.toString() !== req.session.user.id) {
            return res.status(400).json({ success: false, message: 'Email already in use by another account' });
        }
        
        const otp = generateOTP();
        
        req.session.emailChange = {
            newEmail: email,
            otp: otp.toString(),
            expires: Date.now() + 120 * 1000 
        };
        
        await new Promise((resolve, reject) => {
            req.session.save(err => {
                if (err) {
                    console.error('Session save error in resendOtp:', err);
                    reject(new Error('Failed to save session'));
                } else {
                    resolve();
                }
            });
        });
        
        const mailOptions = {
            from: process.env.EMAIL,
            to: email,
            subject: 'Email Verification OTP (Resent)',
            text: `Your new OTP to verify your email is: ${otp}. It expires in 2 minutes.`
        };
        
        await transporter.sendMail(mailOptions);
        console.log(`Resent email verification OTP to ${email}: ${otp}`);
        
        res.json({ success: true, message: 'OTP resent successfully' });
    } catch (error) {
        console.error('Resend OTP Error:', error);
        res.status(500).json({ success: false, message: 'Failed to resend OTP' });
    }
};

const updateProfile = async (req, res) => {
    try {
        if (!req.session.user || !req.session.user.id) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        const userId = req.session.user.id;
        const { name, phone, currentPassword, newPassword, confirmPassword, removeProfileImage } = req.body;
        
        const user = await User.findById(userId);
        if (!user) {
            req.session.destroy();
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        
        let imageUpdated = false;
        const uploadDir = path.normalize(path.join(__dirname, '../../public/uploads/profile'));
        
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        if (req.file) {
            console.log('New image uploaded:', req.file.filename);
            if (user.profileImage && user.profileImage !== '/images/default-profile.png') {
                const oldImagePath = path.normalize(path.join(__dirname, '../../public', user.profileImage));
                if (fs.existsSync(oldImagePath)) {
                    try {
                        fs.unlinkSync(oldImagePath);
                        console.log('Old image deleted:', oldImagePath);
                    } catch (error) {
                        console.error('Error deleting old profile image:', error);
                    }
                }
            }
            user.profileImage = `/uploads/profile/${req.file.filename}`;
            imageUpdated = true;
            console.log('New profile image path:', user.profileImage);
        } else if (removeProfileImage === 'true') {
            if (user.profileImage && user.profileImage !== '/images/default-profile.png') {
                const oldImagePath = path.normalize(path.join(__dirname, '../../public', user.profileImage));
                if (fs.existsSync(oldImagePath)) {
                    try {
                        fs.unlinkSync(oldImagePath);
                        console.log('Profile image deleted:', oldImagePath);
                    } catch (error) {
                        console.error('Error deleting profile image:', error);
                    }
                }
            }
            user.profileImage = '/images/default-profile.png';
            imageUpdated = true;
            console.log('Profile image reset to default');
        }

        if (name) user.name = name.trim();
        if (phone) user.phone = phone;

        if (currentPassword && newPassword && confirmPassword) {
            const isMatch = await bcrypt.compare(currentPassword, user.password);
            if (!isMatch) {
                return res.status(400).json({ success: false, message: 'Current password is incorrect' });
            }
            if (newPassword !== confirmPassword) {
                return res.status(400).json({ success: false, message: 'New passwords do not match' });
            }
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(newPassword, salt);
        }

        if (req.session.emailChange && req.session.emailChange.verified) {
            user.email = req.session.emailChange.newEmail;
            delete req.session.emailChange;
            await new Promise((resolve, reject) => {
                req.session.save(err => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }

        await user.save();
        console.log('User saved with profileImage:', user.profileImage);

        req.session.user = {
            ...req.session.user,
            name: user.name,
            email: user.email,
            phone: user.phone,
            profileImage: user.profileImage
        };

        await new Promise((resolve, reject) => {
            req.session.save(err => {
                if (err) {
                    console.error('Session save error in updateProfile:', err);
                    reject(err);
                } else {
                    console.log('Session updated with new profileImage:', user.profileImage);
                    resolve();
                }
            });
        });

        return res.json({ 
            success: true, 
            message: 'Profile updated successfully',
            profileImage: user.profileImage,
            redirect: '/profile'
        });
    } catch (error) {
        console.error('Update Profile Error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to update profile',
            error: error.message
        });
    }
};
const deleteProfileImage = async (req, res) => {
    try {
        if (!req.session.user || !req.session.user.id) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        const userId = req.session.user.id;
        const user = await User.findById(userId);
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        if (user.profileImage && user.profileImage !== '/images/default-profile.png') {
            const imagePath = path.normalize(path.join(__dirname, '../../public', user.profileImage));
            if (fs.existsSync(imagePath)) {
                try {
                    fs.unlinkSync(imagePath);
                } catch (error) {
                    console.error('Error deleting profile image:', error);
                }
            }
            
            user.profileImage = '/images/default-profile.png';
            await user.save();
            
           
            req.session.user.profileImage = user.profileImage;
            
            
            await new Promise((resolve, reject) => {
                req.session.save(err => {
                    if (err) {
                        console.error('Session save error in deleteProfileImage:', err);
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
            
            return res.json({ 
                success: true, 
                message: 'Profile image deleted successfully',
                profileImage: user.profileImage
            });
        }
        
        return res.json({ success: false, message: 'No custom profile image to delete' });
    } catch (error) {
        console.error('Delete Profile Image Error:', error);
        return res.status(500).json({ success: false, message: 'Failed to delete profile image' });
    }
};

const getAddressesPage = async (req, res) => {
    try {
        console.log("Entered getAddressesPage controller");
        const userId = req.session.user?.id;
        console.log("User ID:", userId);
        
        if (!userId) {
            console.log("No user ID - redirecting to login");
            return res.redirect('/login');
        }
        
        const user = await User.findById(userId);
        if (!user) {
            console.log("User not found");
            return res.redirect('/login');
        }
        
        const addressDoc = await Address.findOne({ userId });
        console.log("Address data:", addressDoc);
        
       
        let sortedAddresses = addressDoc?.address || [];
        if (sortedAddresses.length > 0) {
            sortedAddresses = sortedAddresses.sort((a, b) => {
                return b.isDefault - a.isDefault; 
            });
        }

        res.render('user/addresses', {
            user,
            showForm: false,
            addresses: { address: sortedAddresses },
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

        const address = addressDoc.address.find(addr => addr._id.toString() === addressId);

        if (!address) {
            return res.redirect('/profile/addresses?error=Address not found');
        }

        res.render('user/addresses', {
            user,
            address,
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
        console.log('addAddress: Received request with query- query:', req.query);
        const userId = req.session.user.id;
        const {
            addressType,
            name,
            city,
            landMark,
            state,
            pincode,
            phone,
            altPhone,
            isDefault
        } = req.body;
  
        if (!addressType || !name || !city || !landMark || !state || !pincode || !phone) {
            console.log('addAddress: Missing required fields');
            return res.redirect(`/profile/addresses/add${req.query.from ? '?from=' + req.query.from : ''}&error=Please fill all required fields`);
        }
  
        if (!/^\d{6}$/.test(pincode)) {
            console.log('addAddress: Invalid pincode');
            return res.redirect(`/profile/addresses/add${req.query.from ? '?from=' + req.query.from : ''}&error=Invalid pincode`);
        }
  
        if (!/^\d{10}$/.test(phone)) {
            console.log('addAddress: Invalid phone number');
            return res.redirect(`/profile/addresses/add${req.query.from ? '?from=' + req.query.from : ''}&error=Invalid phone number`);
        }
  
        if (altPhone && !/^\d{10}$/.test(altPhone)) {
            console.log('addAddress: Invalid alternate phone number');
            return res.redirect(`/profile/addresses/add${req.query.from ? '?from=' + req.query.from : ''}&error=Invalid alternate phone number`);
        }
  
        let addressDoc = await Address.findOne({ userId });
  
        const newAddress = {
            _id: new mongoose.Types.ObjectId(), 
            addressType,
            name,
            city,
            landMark,
            state,
            pincode: Number(pincode),
            phone,
            altPhone,
            isDefault: isDefault === 'true' || isDefault === true
        };
  
        if (addressDoc) {
            // If setting new address as default, unset other defaults
            if (newAddress.isDefault) {
                addressDoc.address.forEach(addr => {
                    addr.isDefault = false;
                });
            }
            addressDoc.address.push(newAddress);
            await addressDoc.save();
        } else {
            addressDoc = new Address({
                userId,
                address: [newAddress],
            });
            await addressDoc.save();
        }
  
        if (req.query.from === 'checkout') {
            return res.redirect('/checkout');
        }
  
        res.redirect('/profile/addresses?success=Address added successfully');
    } catch (error) {
        console.error('Add Address Error:', error);
        res.redirect(`/profile/addresses/add${req.query.from ? '?from=' + req.query.from : ''}&error=Failed to add address`);
    }
};

const updateAddress = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const addressId = req.params.id;
        const {
            addressType,
            name,
            city,
            landMark,
            state,
            pincode,
            phone,
            altPhone,
            isDefault
        } = req.body;
        
        if (!addressType || !name || !city || !landMark || !state || !pincode || !phone) {
            return res.redirect(`/profile/addresses/edit/${addressId}?error=Please fill all required fields`);
        }
        
        if (!/^\d{6}$/.test(pincode)) {
            return res.redirect(`/profile/addresses/edit/${addressId}?error=Invalid pincode`);
        }
        
        if (!/^\d{10}$/.test(phone)) {
            return res.redirect(`/profile/addresses/edit/${addressId}?error=Invalid phone number`);
        }
        
        if (altPhone && !/^\d{10}$/.test(altPhone)) {
            return res.redirect(`/profile/addresses/edit/${addressId}?error=Invalid alternate phone number`);
        }

        
        if (isDefault === 'on' || isDefault === true) {
            await Address.findOneAndUpdate(
                { userId },
                { $set: { "address.$[].isDefault": false } }
            );
        }
        
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
                    "address.$.altPhone": altPhone,
                    "address.$.isDefault": isDefault === 'on' || isDefault === true
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
        if (!req.session.user || !req.session.user.id) {
            return res.status(401).json({ success: false, message: 'User not authenticated' });
        }

        const userId = req.session.user.id;
        const addressId = req.params.id;

        if (!mongoose.Types.ObjectId.isValid(addressId)) {
            return res.status(400).json({ success: false, message: 'Invalid address ID' });
        }

        const addressDoc = await Address.findOneAndUpdate(
            { userId },
            { $pull: { address: { _id: addressId } } },
            { new: true }
        );

        if (!addressDoc) {
            return res.status(404).json({ success: false, message: 'Address not found' });
        }

        const from = req.query.from || '';
        if (from === 'checkout') {
            return res.json({ success: true, redirect: '/checkout?success=Address deleted successfully' });
        }

        return res.json({ success: true, redirect: '/profile/addresses?success=Address deleted successfully' });
    } catch (error) {
        console.error('Delete Address Error:', error);
        return res.status(500).json({ success: false, message: 'Failed to delete address', error: error.message });
    }
};

const setDefaultAddress = async (req, res) => {
    try {
        if (!req.session.user || !req.session.user.id) {
            return res.status(401).json({ success: false, message: 'User not authenticated' });
        }

        const userId = req.session.user.id;
        const addressId = req.params.id;

        console.log(`Setting default address for user ${userId}, address ID: ${addressId}`);

        if (!mongoose.Types.ObjectId.isValid(addressId)) {
            console.log('Invalid address ID:', addressId);
            return res.status(400).json({ success: false, message: 'Invalid address ID' });
        }

        
        const addressDoc = await Address.findOne({ userId, "address._id": addressId });
        if (!addressDoc) {
            console.log('Address not found for ID:', addressId);
            return res.status(404).json({ success: false, message: 'Address not found' });
        }

        
        await Address.findOneAndUpdate(
            { userId },
            { $set: { "address.$[].isDefault": false } }
        );

        
        const updatedAddressDoc = await Address.findOneAndUpdate(
            { userId, "address._id": addressId },
            { $set: { "address.$.isDefault": true } },
            { new: true }
        );

        if (!updatedAddressDoc) {
            console.log('Failed to update address to default');
            return res.status(404).json({ success: false, message: 'Address not found' });
        }

        return res.json({ success: true, message: 'Default address set successfully' });
    } catch (error) {
        console.error('Set Default Address Error:', error);
        return res.status(500).json({ success: false, message: 'Failed to set default address', error: error.message });
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
    sendOtpForEmail,
    verifyEmailChangeOtp,
    resendOtp,
    updateProfile,
    deleteProfileImage,

    getAddressesPage,
    getAddAddressPage,
    getEditAddressPage,
    addAddress,
    updateAddress,
    deleteAddress,
    setDefaultAddress
};