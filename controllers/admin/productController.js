// controllers/admin/productController.js
const mongoose = require('mongoose');
const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const User = require("../../models/userSchema");
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

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
        const status = parseInt(quantity) === 0 ? "out of stock" : "Available";

        const newProduct = new Product({
            productName,
            category,
            description,
            regularPrice: parseFloat(regularPrice),
            salesPrice: parseFloat(salesPrice),
            quantity: parseInt(quantity),
            productImage: images,
        });

        const savedProduct = await newProduct.save();
        console.log("Product saved:", savedProduct);

        // Set success message in session
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

// Update Product
const updateProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const { productName, category, description, regularPrice, salesPrice, quantity, isBlocked } = req.body;
    const images = req.files ? req.files.map(file => `/uploads/products/${file.filename}`) : [];

    const updateData = {
      productName,
      category,
      description,
      regularPrice: parseFloat(regularPrice),
      salesPrice: parseFloat(salesPrice),
      quantity: parseInt(quantity),
      isBlocked: isBlocked === 'true' // Convert string to boolean
    };

    if (images.length > 0) {
      updateData.productImage = images;
    }

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

// Block (Soft Delete) Product
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

// Unblock (Restore) Product
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
        .sort({ createdAt: -1 })
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


module.exports = {
    getProductAddPage,
    addProduct,
    getAllProducts,
    getEditProductPage,
    updateProduct,
    blockProduct,
    unblockProduct

};