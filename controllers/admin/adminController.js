const User = require("../../models/userSchema.js");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const Order = require('../../models/orderSchema');
const Coupon = require('../../models/couponSchema');
const Product = require("../../models/productSchema.js");
const Category = require("../../models/categorySchema.js");

const pageerror = async (req, res) => {
    res.render('admin/dashboard', { 
        currentRoute: 'dashboard', 
        errorPage: 'admin-error',
        errorMessage: 'Page not found',
        filterType: 'daily',
        startDate: null,
        endDate: null,
        salesData: null,
        totalUsers: 0,
        totalProducts: 0,
        totalUsersGrowth: 0,
        totalProductsGrowth: 0,
        totalOrdersGrowth: 0,
        totalRevenueGrowth: 0,
        recentOrders: [],
        chartData: null,
        topProducts: [],
        topCategories: [],
        currentPage: 1,
        totalPages: 1
    });
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
                return res.redirect("/admin/dashboard");
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

        const { filterType = 'daily', startDate, endDate, page = 1, limit = 10 } = req.query;

        // Date filter for orders
        let dateFilter = {};
        let chartDateFilter = {};
        const now = new Date();
        
        if (filterType === 'daily') {
            dateFilter = {
                createdOn: {
                    $gte: new Date(now.setHours(0, 0, 0, 0)),
                    $lte: new Date(now.setHours(23, 59, 59, 999)),
                },
            };
            chartDateFilter = { $gte: new Date(now.setHours(0, 0, 0, 0)) }; // For daily chart (last 24 hours)
        } else if (filterType === 'weekly') {
            const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
            startOfWeek.setHours(0, 0, 0, 0);
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);
            endOfWeek.setHours(23, 59, 59, 999);
            dateFilter = {
                createdOn: { $gte: startOfWeek, $lte: endOfWeek },
            };
            chartDateFilter = { $gte: startOfWeek, $lte: endOfWeek }; // For weekly chart
        } else if (filterType === 'monthly') {
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            endOfMonth.setHours(23, 59, 59, 999);
            dateFilter = {
                createdOn: { $gte: startOfMonth, $lte: endOfMonth },
            };
            chartDateFilter = { $gte: startOfMonth, $lte: endOfMonth }; // For monthly chart
        } else if (filterType === 'yearly') {
            const startOfYear = new Date(now.getFullYear(), 0, 1);
            const endOfYear = new Date(now.getFullYear(), 11, 31);
            endOfYear.setHours(23, 59, 59, 999);
            dateFilter = {
                createdOn: { $gte: startOfYear, $lte: endOfYear },
            };
            chartDateFilter = { $gte: startOfYear, $lte: endOfYear }; // For yearly chart
        } else if (filterType === 'custom' && startDate && endDate) {
            dateFilter = {
                createdOn: {
                    $gte: new Date(startDate),
                    $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)),
                },
            };
            chartDateFilter = { $gte: new Date(startDate), $lte: new Date(endDate) }; // For custom range chart
        }

        // Fetch total number of orders for pagination
        const totalOrdersCount = await Order.countDocuments({
            ...dateFilter,
            status: { $in: ['Placed', 'Processing', 'Shipped', 'Delivered'] }
        });

        // Calculate pagination parameters
        const currentPage = parseInt(page);
        const totalPages = Math.ceil(totalOrdersCount / limit);
        const skip = (currentPage - 1) * limit;

        // Fetch paginated orders
        const orders = await Order.find({
            ...dateFilter,
            status: { $in: ['Placed', 'Processing', 'Shipped', 'Delivered'] }
        })
            .populate('orderedItems.product user')
            .sort({ createdOn: -1 })
            .skip(skip)
            .limit(limit);

        const totalUsers = await User.countDocuments({ isAdmin: false });
        const totalProducts = await Product.countDocuments();

        let totalOrders = totalOrdersCount; // Use the total count for display
        let totalAmount = 0;
        let totalDiscount = 0;
        let totalCoupons = 0;

        // Calculate totals based on all orders (not just paginated ones)
        const allOrders = await Order.find({
            ...dateFilter,
            status: { $in: ['Placed', 'Processing', 'Shipped', 'Delivered'] }
        });
        allOrders.forEach(order => {
            totalAmount += order.finalAmount;
            totalDiscount += order.discount || 0;
            if (order.couponApplied) totalCoupons++;
        });

        const formattedOrders = orders.map(order => ({
            orderId: order.orderId,
            customerName: order.user ? order.user.name : 'Unknown',
            product: order.orderedItems && order.orderedItems.length > 0 
                ? (order.orderedItems[0].product ? order.orderedItems[0].product.productName : 'Unknown Product') 
                : 'No Products',
            amount: order.finalAmount,
            status: order.status,
            date: order.createdOn
        }));

        const salesData = {
            orders: formattedOrders,
            totalOrders,
            totalAmount,
            totalDiscount,
            totalCoupons
        };

        // Fetch data for Revenue & Orders Overview Chart
        const chartOrders = await Order.find({
            createdOn: chartDateFilter,
            status: { $in: ['Placed', 'Processing', 'Shipped', 'Delivered'] }
        }).populate('orderedItems.product user');

        let chartData = { labels: [], revenue: [], ordersCount: [] };
        if (filterType === 'daily') {
            // Hourly data for the day
            const hours = Array.from({ length: 24 }, (_, i) => i);
            chartData.labels = hours.map(hour => `${hour}:00`);
            chartData.revenue = hours.map(hour => {
                return chartOrders
                    .filter(order => new Date(order.createdOn).getHours() === hour)
                    .reduce((sum, order) => sum + order.finalAmount, 0);
            });
            chartData.ordersCount = hours.map(hour => {
                return chartOrders.filter(order => new Date(order.createdOn).getHours() === hour).length;
            });
        } else if (filterType === 'weekly') {
            // Daily data for the week
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            chartData.labels = days;
            chartData.revenue = days.map((_, i) => {
                return chartOrders
                    .filter(order => new Date(order.createdOn).getDay() === i)
                    .reduce((sum, order) => sum + order.finalAmount, 0);
            });
            chartData.ordersCount = days.map((_, i) => {
                return chartOrders.filter(order => new Date(order.createdOn).getDay() === i).length;
            });
        } else if (filterType === 'monthly') {
            // Daily data for the month
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            chartData.labels = Array.from({ length: daysInMonth }, (_, i) => (i + 1).toString());
            chartData.revenue = Array.from({ length: daysInMonth }, (_, i) => {
                return chartOrders
                    .filter(order => new Date(order.createdOn).getDate() === (i + 1))
                    .reduce((sum, order) => sum + order.finalAmount, 0);
            });
            chartData.ordersCount = Array.from({ length: daysInMonth }, (_, i) => {
                return chartOrders.filter(order => new Date(order.createdOn).getDate() === (i + 1)).length;
            });
        } else if (filterType === 'yearly') {
            // Monthly data for the year
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            chartData.labels = months;
            chartData.revenue = months.map((_, i) => {
                return chartOrders
                    .filter(order => new Date(order.createdOn).getMonth() === i)
                    .reduce((sum, order) => sum + order.finalAmount, 0);
            });
            chartData.ordersCount = months.map((_, i) => {
                return chartOrders.filter(order => new Date(order.createdOn).getMonth() === i).length;
            });
        } else if (filterType === 'custom' && startDate && endDate) {
            // Daily data for the custom range
            const start = new Date(startDate);
            const end = new Date(endDate);
            const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
            chartData.labels = Array.from({ length: daysDiff }, (_, i) => {
                const date = new Date(start);
                date.setDate(date.getDate() + i);
                return date.toISOString().split('T')[0];
            });
            chartData.revenue = chartData.labels.map(label => {
                return chartOrders
                    .filter(order => new Date(order.createdOn).toISOString().split('T')[0] === label)
                    .reduce((sum, order) => sum + order.finalAmount, 0);
            });
            chartData.ordersCount = chartData.labels.map(label => {
                return chartOrders.filter(order => new Date(order.createdOn).toISOString().split('T')[0] === label).length;
            });
        }

        // Fetch Top 10 Best-Selling Products
        const productSales = await Order.aggregate([
            { $match: { status: { $in: ['Placed', 'Processing', 'Shipped', 'Delivered'] } } },
            { $unwind: '$orderedItems' },
            {
                $group: {
                    _id: '$orderedItems.product',
                    totalSold: { $sum: '$orderedItems.quantity' }
                }
            },
            { $sort: { totalSold: -1 } },
            { $limit: 10 },
            {
                $lookup: {
                    from: 'products',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'product'
                }
            },
            { $unwind: '$product' }
        ]);

        const topProducts = productSales.map(item => ({
            name: item.product.productName,
            totalSold: item.totalSold
        }));

        // Fetch Top 10 Best-Selling Categories
        const categorySales = await Order.aggregate([
            { $match: { status: { $in: ['Placed', 'Processing', 'Shipped', 'Delivered'] } } },
            { $unwind: '$orderedItems' },
            {
                $lookup: {
                    from: 'products',
                    localField: 'orderedItems.product',
                    foreignField: '_id',
                    as: 'product'
                }
            },
            { $unwind: '$product' },
            {
                $group: {
                    _id: '$product.category',
                    totalSold: { $sum: '$orderedItems.quantity' }
                }
            },
            { $sort: { totalSold: -1 } },
            { $limit: 10 },
            {
                $lookup: {
                    from: 'categories',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'category'
                }
            },
            { $unwind: '$category' }
        ]);

        const topCategories = categorySales.map(item => ({
            name: item.category.name,
            totalSold: item.totalSold
        }));

        const recentOrders = await Order.find({
            status: { $in: ['Placed', 'Processing', 'Shipped', 'Delivered'] }
        })
            .sort({ createdOn: -1 })
            .limit(5)
            .populate('orderedItems.product user');

        res.render("admin/dashboard", {
            currentRoute: 'dashboard',
            errorPage: null,
            errorMessage: null,
            salesData,
            totalUsers,
            totalProducts,
            totalUsersGrowth: 5.3,
            totalProductsGrowth: 7.1,
            totalOrdersGrowth: 3.2,
            totalRevenueGrowth: 8.5,
            recentOrders,
            filterType,
            startDate: startDate || dateFilter.createdOn?.$gte?.toISOString().split('T')[0],
            endDate: endDate || dateFilter.createdOn?.$lte?.toISOString().split('T')[0],
            chartData,
            topProducts,
            topCategories,
            currentPage,
            totalPages
        });
    } catch (error) {
        console.error("Error loading dashboard:", error);
        res.render("admin/dashboard", {
            currentRoute: 'dashboard',
            errorPage: 'admin-error',
            errorMessage: 'Error loading dashboard: ' + error.message,
            salesData: null,
            totalUsers: 0,
            totalProducts: 0,
            totalUsersGrowth: 0,
            totalProductsGrowth: 0,
            totalOrdersGrowth: 0,
            totalRevenueGrowth: 0,
            recentOrders: [],
            filterType: 'daily',
            startDate: null,
            endDate: null,
            chartData: null,
            topProducts: [],
            topCategories: [],
            currentPage: 1,
            totalPages: 1
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
        console.log("Unexpected error during logout", error);
        res.redirect("/pageerror");
    }
};

const getSalesReport = async (req, res) => {
    try {
        const { filterType, startDate, endDate } = req.query;

        let dateFilter = {};
        const now = new Date();
        
        if (filterType === 'daily') {
            dateFilter = {
                createdOn: {
                    $gte: new Date(now.setHours(0, 0, 0, 0)),
                    $lte: new Date(now.setHours(23, 59, 59, 999)),
                },
            };
        } else if (filterType === 'weekly') {
            const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
            startOfWeek.setHours(0, 0, 0, 0);
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);
            endOfWeek.setHours(23, 59, 59, 999);
            dateFilter = {
                createdOn: { $gte: startOfWeek, $lte: endOfWeek },
            };
        } else if (filterType === 'monthly') {
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            endOfMonth.setHours(23, 59, 59, 999);
            dateFilter = {
                createdOn: { $gte: startOfMonth, $lte: endOfMonth },
            };
        } else if (filterType === 'yearly') {
            const startOfYear = new Date(now.getFullYear(), 0, 1);
            const endOfYear = new Date(now.getFullYear(), 11, 31);
            endOfYear.setHours(23, 59, 59, 999);
            dateFilter = {
                createdOn: { $gte: startOfYear, $lte: endOfYear },
            };
        } else if (filterType === 'custom' && startDate && endDate) {
            dateFilter = {
                createdOn: {
                    $gte: new Date(startDate),
                    $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)),
                },
            };
        }

        const orders = await Order.find(dateFilter)
            .populate('user', 'name')
            .populate('orderedItems.product', 'productName') 
            .sort({ createdOn: -1 }); 

        const totalOrders = orders.length;
        const totalAmount = orders.reduce((sum, order) => sum + order.finalAmount, 0);
        const totalDiscount = orders.reduce((sum, order) => sum + (order.discount || 0), 0);
        const totalCoupons = orders.filter(order => order.couponApplied).length;

        const salesData = {
            orders,
            totalOrders,
            totalAmount,
            totalDiscount,
            totalCoupons,
        };

        res.render('admin/sales-report', {
            salesData,
            filterType,
            startDate,
            endDate,
            errorMessage: null,
        });
    } catch (error) {
        console.error(error);
        res.render('admin/sales-report', {
            salesData: null,
            filterType,
            startDate,
            endDate,
            errorMessage: 'Failed to load sales data.',
        });
    }
};

const downloadReport = async (req, res) => {
    try {
        const { format, filterType, startDate, endDate } = req.query; // Fixed: Corrected parameter name from 'Lottery' to 'filterType'
        let start, end;

        const now = new Date();
        switch (filterType) {
            case 'daily':
                start = new Date(now.setHours(0, 0, 0, 0));
                end = new Date(now.setHours(23, 59, 59, 999));
                break;
            case 'weekly':
                start = new Date(now.setDate(now.getDate() - now.getDay()));
                start.setHours(0, 0, 0, 0);
                end = new Date(start);
                end.setDate(start.getDate() + 6);
                end.setHours(23, 59, 59, 999);
                break;
            case 'monthly':
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                end.setHours(23, 59, 59, 999);
                break;
            case 'yearly':
                start = new Date(now.getFullYear(), 0, 1);
                end = new Date(now.getFullYear(), 11, 31);
                end.setHours(23, 59, 59, 999);
                break;
            case 'custom':
                start = new Date(startDate);
                end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                break;
            default:
                start = new Date(0);
                end = new Date();
        }

        const orders = await Order.find({
            createdOn: { $gte: start, $lte: end },
            status: { $in: ['Placed', 'Processing', 'Shipped', 'Delivered'] }
        }).populate('orderedItems.product user');

        let totalOrders = orders.length;
        let totalAmount = 0;
        let totalDiscount = 0;
        let totalCoupons = 0;

        orders.forEach(order => {
            totalAmount += order.finalAmount;
            totalDiscount += order.discount || 0;
            if (order.couponApplied) totalCoupons++;
        });

        if (format === 'pdf') {
            const doc = new PDFDocument();
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=sales-report-${filterType}.pdf`);

            doc.pipe(res);

            doc.fontSize(20).text('Sales Report', { align: 'center' });
            doc.moveDown();
            doc.fontSize(12).text(`Period: ${filterType.toUpperCase()}`);
            if (filterType === 'custom') {
                doc.text(`From: ${start.toISOString().split('T')[0]} To: ${end.toISOString().split('T')[0]}`);
            }
            doc.moveDown();

            doc.text(`Total Orders: ${totalOrders}`);
            doc.text(`Total Amount: ₹${totalAmount.toFixed(2)}`); 
            doc.text(`Total Discount: ₹${totalDiscount.toFixed(2)}`); 
            doc.text(`Total Coupons Applied: ${totalCoupons}`);
            doc.moveDown();

            doc.text('Order Details:', { underline: true });
            orders.forEach((order, index) => {
                doc.text(`Order ${index + 1}:`);
                doc.text(`Order ID: ${order.orderId}`);
                doc.text(`Date: ${new Date(order.createdOn).toLocaleDateString()}`);
                doc.text(`Amount: ₹${order.finalAmount.toFixed(2)}`); 
                doc.text(`Discount: ₹${order.discount.toFixed(2)}`); 
                doc.text(`Coupon: ${order.couponApplied ? order.appliedCoupon || 'Applied' : 'None'}`);
                doc.moveDown();
            });

            doc.end();
        } else if (format === 'excel') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Sales Report');

            worksheet.columns = [
                { header: 'Order ID', key: 'orderId', width: 20 },
                { header: 'Date', key: 'date', width: 15 },
                { header: 'Amount (₹)', key: 'amount', width: 15 },
                { header: 'Discount (₹)', key: 'discount', width: 15 },
                { header: 'Coupon', key: 'coupon', width: 15 }
            ];

            orders.forEach(order => {
                worksheet.addRow({
                    orderId: order.orderId,
                    date: new Date(order.createdOn).toLocaleDateString(),
                    amount: order.finalAmount.toFixed(2),
                    discount: order.discount.toFixed(2),
                    coupon: order.couponApplied ? order.appliedCoupon || 'Applied' : 'None'
                });
            });

            worksheet.addRow({});
            worksheet.addRow({ orderId: 'Total Orders', amount: totalOrders });
            worksheet.addRow({ orderId: 'Total Amount', amount: totalAmount.toFixed(2) });
            worksheet.addRow({ orderId: 'Total Discount', amount: totalDiscount.toFixed(2) });
            worksheet.addRow({ orderId: 'Total Coupons', amount: totalCoupons });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=sales-report-${filterType}.xlsx`);

            await workbook.xlsx.write(res);
            res.end();
        } else {
            res.status(400).send('Invalid format');
        }
    } catch (error) {
        console.error('Error downloading report:', error);
        res.redirect('/pageerror');
    }
};

module.exports = {
    loadLogin,
    login,
    loadDashboard,
    pageerror,
    logout,
    getSalesReport,
    downloadReport
};