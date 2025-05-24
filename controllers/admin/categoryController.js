const mongoose = require("mongoose");
const Category = require("../../models/categorySchema");
const Product = require("../../models/productSchema"); 

const categoryInfo = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 4;
        const skip = (page - 1) * limit;
        const searchQuery = req.query.search ? req.query.search.trim() : "";

        let filter = {};
        if (req.query.clear) {
            filter = {};
        } else if (searchQuery) {
            filter = { name: { $regex: searchQuery, $options: 'i' } };
        }

        const categoryData = await Category.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const totalCategories = await Category.countDocuments(filter);
        const totalPages = totalCategories > 0 ? Math.ceil(totalCategories / limit) : 1;

        res.render("admin/category", {
            categories: categoryData,
            currentPage: page,
            totalPages: totalPages,
            totalCategories: totalCategories,
            limit: limit,
            searchQuery: searchQuery
        });
    } catch (error) {
        console.error("Error fetching categories:", error);
        res.render("admin/category", {
            categories: [],
            currentPage: 1,
            totalPages: 1,
            totalCategories: 0,
            limit: 4,
            searchQuery: ""
        });
    }
};

const addCategory = async (req, res) => {
    try {
        const { name, description } = req.body;

        const existingCategory = await Category.findOne({
            name: { $regex: new RegExp(`^${name}$`, 'i') }
        });

        if (existingCategory) {
            return res.render("admin/add-category", {
                error: "Category name already exists!",
                name,
                description
            });
        }

        const newCategory = new Category({
            name,
            description,
            categoryOffer: 0
        });

        await newCategory.save();
        res.redirect("/admin/category");
    } catch (error) {
        console.error("Error adding category:", error);
        res.render("admin/add-category", {
            error: "Something went wrong. Please try again.",
            name: "",
            description: ""
        });
    }
};

const addOffer = async (req, res) => {
    try {
        const { categoryId, offerPercentage } = req.body;

        const offer = parseInt(offerPercentage);
        if (isNaN(offer) || offer < 0 || offer > 100) {
            return res.json({ success: false, message: "Offer percentage must be between 0 and 100" });
        }

        const category = await Category.findById(categoryId);
        if (!category) {
            return res.json({ success: false, message: "Category not found" });
        }

        category.categoryOffer = offer;
        await category.save();

        const products = await Product.find({ category: categoryId });
        for (const product of products) {
           
            if (!product || product.regularPrice === undefined) {
                console.warn(`Skipping product with ID ${product?._id || 'unknown'}: regularPrice is undefined`);
                continue;
            }

            const categoryOffer = category.categoryOffer || 0;
            const productOffer = product.productOffer || 0;
            const maxDiscountPercentage = Math.max(categoryOffer, productOffer);
            const regularPrice = parseFloat(product.regularPrice) || 0;

            product.salesPrice = maxDiscountPercentage > 0
                ? regularPrice - (regularPrice * maxDiscountPercentage / 100)
                : regularPrice;
            product.totalOffer = maxDiscountPercentage;
            product.offerType = maxDiscountPercentage > 0
                ? (categoryOffer > productOffer ? 'category' : 'product')
                : 'none';

            await product.save();
        }

        return res.json({ success: true, offer: category.categoryOffer });
    } catch (error) {
        console.error("Error adding offer:", error);
        return res.json({ success: false, message: "Server error while adding offer" });
    }
};

const removeOffer = async (req, res) => {
    try {
        const { categoryId } = req.body;

        const category = await Category.findById(categoryId);
        if (!category) {
            return res.json({ success: false, message: "Category not found" });
        }

        category.categoryOffer = 0;
        await category.save();

        const products = await Product.find({ category: categoryId });
        for (const product of products) {
            
            if (!product || product.regularPrice === undefined) {
                console.warn(`Skipping product with ID ${product?._id || 'unknown'}: regularPrice is undefined`);
                continue;
            }

            const categoryOffer = 0;
            const productOffer = product.productOffer || 0;
            const maxDiscountPercentage = Math.max(categoryOffer, productOffer);
            const regularPrice = parseFloat(product.regularPrice) || 0;

            product.salesPrice = maxDiscountPercentage > 0
                ? regularPrice - (regularPrice * maxDiscountPercentage / 100)
                : regularPrice;
            product.totalOffer = maxDiscountPercentage;
            product.offerType = maxDiscountPercentage > 0 ? 'product' : 'none';

            await product.save();
        }

        return res.json({ success: true, offer: 0 });
    } catch (error) {
        console.error("Error removing offer:", error);
        return res.json({ success: false, message: "Server error while removing offer" });
    }
};
const editCategoryPage = async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.redirect("/admin/category?error=Category not found");
        }
        res.render("admin/editCategory", { category });
    } catch (error) {
        console.error("Error loading category for edit:", error);
        res.redirect("/admin/category?error=Error loading category");
    }
};

const updateCategory = async (req, res) => {
    try {
        const { categoryName, description } = req.body;
        const categoryId = req.params.id;

        const name = categoryName?.trim();
        const desc = description?.trim();

        if (!name || name.length === 0) {
            return res.json({
                success: false,
                message: "Category name is required"
            });
        }

        if (name.length < 3) {
            return res.json({
                success: false,
                message: "Category name must be at least 3 characters"
            });
        }

        if (!desc || desc.length === 0) {
            return res.json({
                success: false,
                message: "Description is required"
            });
        }

        if (desc.length < 5) {
            return res.json({
                success: false,
                message: "Description must be at least 5 characters"
            });
        }

        const existingCategory = await Category.findOne({
            _id: { $ne: categoryId },
            name: { $regex: new RegExp(`^${name}$`, 'i') }
        });

        if (existingCategory) {
            return res.json({
                success: false,
                message: "Another category with the same name already exists!"
            });
        }

        await Category.findByIdAndUpdate(categoryId, {
            name: name,
            description: desc
        });

        res.json({ success: true, message: "Category updated successfully" });
    } catch (error) {
        console.error("Error updating category:", error);
        res.json({ success: false, message: "Error updating category" });
    }
};

const deleteCategory = async (req, res) => {
    try {
        await Category.findByIdAndDelete(req.params.id);
        return res.json({ success: true });
    } catch (error) {
        console.error("Error deleting category:", error);
        return res.json({ success: false, message: "Error deleting category" });
    }
};

const toggleCategoryStatus = async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }

        category.status = category.status === "active" ? "inactive" : "active";
        await category.save();

        return res.json({
            success: true,
            newStatus: category.status,
            message: `Category is now ${category.status}`
        });
    } catch (error) {
        console.error("Error toggling category status:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

const listCategory = async (req, res) => {
    try {
        const categoryId = req.params.id;
        await Category.findByIdAndUpdate(categoryId, { isListed: true });
        res.json({ success: true });
    } catch (error) {
        console.error("Error listing category:", error);
        res.json({ success: false, message: error.message });
    }
};

const unlistCategory = async (req, res) => {
    try {
        const categoryId = req.params.id;
        await Category.findByIdAndUpdate(categoryId, { isListed: false });
        res.json({ success: true });
    } catch (error) {
        console.error("Error unlisting category:", error);
        res.json({ success: false, message: error.message });
    }
};
module.exports = {
    categoryInfo,
    addCategory,
    addOffer,
    removeOffer,
    editCategoryPage,
    updateCategory,
    toggleCategoryStatus,
    deleteCategory,
    listCategory,
    unlistCategory
};