const mongoose = require("mongoose");
const Category=require("../../models/categorySchema")

const categoryInfo = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 4;
        const skip = (page - 1) * limit;
        const searchQuery = req.query.search ? req.query.search.trim() : "";
        console.log("Search Query Received:", `"${searchQuery}"`);

        let filter = {};
        // Check for clear first to reset the filter
        if (req.query.clear) {
            filter = {}; // Reset filter to show all categories
        } else if (searchQuery) {
            filter = { name: { $regex: searchQuery, $options: 'i' } }; // Case-insensitive search
        }

        const categoryData = await Category.find(filter)
            .sort({ createdAt: -1 }) // Sort newest first
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
            searchQuery: searchQuery // Keeps search text in input after searching
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
    const newCategory = new Category({ name, description, categoryOffer: 0 });
    const savedCategory = await newCategory.save();
    req.session.successMessage = "Category added successfully!";
    res.json({ success: true, category: savedCategory });
  } catch (error) {
    console.error("Error adding category:", error);
    res.json({ success: false, message: error.message });
  }
};

const addOffer = async (req, res) => {
    try {
        const { categoryId, offerPercentage } = req.body;
        const category = await Category.findById(categoryId);
        if (!category) {
            return res.json({ success: false, message: "Category not found" });
        }
        category.categoryOffer = parseInt(offerPercentage);
        await category.save();
        return res.json({ success: true, offer: category.categoryOffer });
    } catch (error) {
        console.error("Error adding offer:", error);
        return res.json({ success: false, message: "Server Error" });
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
        return res.json({ success: true, offer: 0 });
    } catch (error) {
        console.error("Error removing offer:", error);
        return res.json({ success: false, message: "Server Error" });
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
        await Category.findByIdAndUpdate(req.params.id, { 
            name: categoryName,
            description: description,
           
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
        return res.json({ success: false });
    }
};


const toggleCategoryStatus = async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }
        
        // Toggle the status correctly
        category.status = category.status === "active" ? "inactive" : "active";
        await category.save();

        return res.json({
            success: true,
            newStatus: category.status,
            message: `Category is now ${category.status}`
        });
    } catch (error) {
        console.error("Error toggling category status:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

const getEditCategory = async (req, res) => {
    try {
        const id = req.params.id;
        const category = await Category.findById(id);

        if (!category) {
            return res.redirect("/admin/category?error=Category not found");
        }

        res.render("admin/editCategory", { category });
    } catch (error) {
        console.error("Error loading category for edit:", error);
        res.redirect("/admin/category?error=Error loading category");
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






module.exports={
    categoryInfo,
    addCategory,
    addOffer,
    removeOffer,
    editCategoryPage,
    updateCategory,
    toggleCategoryStatus,
    deleteCategory,
    getEditCategory,
    listCategory,
    unlistCategory
    
}