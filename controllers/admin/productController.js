const mongoose = require('mongoose');
const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const User = require("../../models/userSchema");


const getProductAddPage = async (req, res) => {
    try {
        const category = await Category.find({ isListed: true });
        res.render("admin/add-product", {
            category: category,
            currentRoute: 'add-product'
        });
    } catch (error) {
        console.error("Error in getProductAddPage:", error);
        res.redirect("/pageerror");
    }
};
const addProduct = async (req, res) => {
  try {
      const { productName, category, description, regularPrice, salesPrice, quantity } = req.body;
      const images = req.files ? req.files.map(file => `/uploads/products/${file.filename}`) : [];
      if (!productName || !category || !description || !regularPrice || !salesPrice || quantity === undefined || quantity === null || !images.length) {
          throw new Error("All required fields must be provided");
      }
      
      if (images.length > 4) {
          throw new Error("Cannot upload more than 4 images");
      }



      const newProduct = new Product({
          productName,
          category,
          description,
          regularPrice: parseFloat(regularPrice),
          salesPrice: parseFloat(salesPrice),
          quantity: parseInt(quantity),
          productImage: images,
          status: parseInt(quantity) === 0 ? "out of stock" : "Available"
      });

      const savedProduct = await newProduct.save();
    

      console.log("Product saved:", savedProduct);

      req.session.successMessage = "Product added successfully!";
      res.redirect("/admin/products");
  } catch (error) {
      console.error("Error adding product:", error.message);
      res.redirect("/pageerror");
  }
};

const getEditProductPage = async (req, res) => {
  try {
    const productId = req.params.id;
    const product = await Product.findById(productId).populate('category');
    const categories = await Category.find({ isListed: true });

    if (!product) {
      throw new Error("Product not found");
    }

    res.render("admin/edit-product", {
      product,
      category: categories,
      currentRoute: 'edit-product'
    });
  } catch (error) {
    console.error("Error in getEditProductPage:", error);
    res.redirect("/pageerror");
  }
};

const updateProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const { productName, category, description, regularPrice, salesPrice, quantity, isBlocked, existingImages, removedImages } = req.body;
    const newImages = req.files ? req.files.map(file => `/uploads/products/${file.filename}`) : [];

    
   
    const product = await Product.findById(productId);
    if (!product) {
      throw new Error("Product not found");
    }

   
    let currentImages = Array.isArray(existingImages) ? existingImages : existingImages ? [existingImages] : [];
    const imagesToRemove = Array.isArray(removedImages) ? removedImages : removedImages ? [removedImages] : [];

   
    currentImages = currentImages.filter(img => !imagesToRemove.includes(img));

    
    const updatedImages = [...currentImages, ...newImages];
    if (updatedImages.length < 3) {
      req.session.warningMessage = "You must have at least 3 product images.";
      return res.redirect(`/admin/products/edit/${productId}`);
    }

    const updateData = {
      productName,
      category,
      description,
      regularPrice: parseFloat(regularPrice),
      salesPrice: parseFloat(salesPrice),
      quantity: parseInt(quantity),
      isBlocked: isBlocked === 'true',  
      productImage: updatedImages,
      status: parseInt(quantity) === 0 ? "out of stock" : "Available"
  
    };

    const updatedProduct = await Product.findByIdAndUpdate(productId, updateData, { new: true });
    if (!updatedProduct) {
      throw new Error("Product not found");
    }
   


    req.session.successMessage = "Product updated successfully!";
    res.redirect("/admin/products");
  } catch (error) {
    console.error("Error updating product:", error);
    res.redirect("/pageerror");
  }
};


const blockProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const product = await Product.findByIdAndUpdate(
      productId,
      { isBlocked: true },
      { new: true }
    );

    if (!product) {
      return res.json({ success: false, message: "Product not found" });
    }

    res.json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    console.error("Error blocking product:", error);
    res.json({ success: false, message: "Failed to delete product" });
  }
};


const unblockProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const product = await Product.findByIdAndUpdate(
      productId,
      { isBlocked: false },
      { new: true }
    );

    if (!product) {
      return res.json({ success: false, message: "Product not found" });
    }

    res.json({ success: true, message: "Product restored successfully" });
  } catch (error) {
    console.error("Error unblocking product:", error);
    res.json({ success: false, message: "Failed to restore product" });
  }
};

const getAllProducts = async (req, res) => {
    try {
      const search = req.query.search || '';
      const page = parseInt(req.query.page) || 1;
      const limit = 4;
  
      const query = {
        $or: [
          { productName: new RegExp(search, 'i') },
          { 'category.name': new RegExp(search, 'i') }
        ]
      };
  
      const products = await Product.find(query)
        .populate('category')
        .skip((page - 1) * limit)
        .limit(limit);
  
      const total = await Product.countDocuments(query);
      const totalPages = Math.ceil(total / limit);
  
      const successMessage = req.session.successMessage || null;
      delete req.session.successMessage;
  
      console.log('Products fetched:', products);
  
      res.render('admin/products', {
        products: products || [],
        search: search,
        currentPage: page,
        totalPages: totalPages,
        successMessage: successMessage
      });
    } catch (error) {
      console.error('Error in getAllProducts:', error);
      res.redirect("/pageerror");
    }
};

const loadProfile = async (req, res) => {
  try {
      console.log('Session user:', req.session.user);
      if (!req.session.user || !req.session.user.id) {
          console.log('No user session found, redirecting to login');
          return res.redirect('/login');
      }

      
      const user = await User.findById(req.session.user.id);
      if (!user) {
          console.log('User not found in database');
          return res.redirect('/login');
      }

      const orders = await Order.find({ user: req.session.user.id });       
      res.render('user/profile', {
          section: req.query.section || 'overview',
          user: {
              name: user.name || 'Unknown',
              email: user.email || '',
              phone: user.phone || '',
              profileImage: user.profileImage || 'https://via.placeholder.com/150',
              addresses: user.addresses || []
          },
          orders: orders || [],
          otpSent: req.session.otpSent || false
      });
  } catch (error) {
      console.error('Error in loadProfile:', error);
      res.redirect('/pageNotFound');
  }
};


module.exports = {
    getProductAddPage,
    addProduct,
    getAllProducts,
    getEditProductPage,
    updateProduct,
    blockProduct,
    unblockProduct,
    loadProfile
   
};