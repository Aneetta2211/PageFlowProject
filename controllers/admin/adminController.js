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

       
        let dateFilter = {};
        let chartDateFilter = {};
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

        switch (filterType) {
            case 'daily':
                dateFilter = {
                    createdOn: {
                        $gte: new Date(now.setHours(0, 0, 0, 0)),
                        $lte: new Date(now.setHours(23, 59, 59, 999)),
                    },
                };
                chartDateFilter = { $gte: new Date(now.setHours(0, 0, 0, 0)), $lte: new Date(now.setHours(23, 59, 59, 999)) };
                break;
            case 'weekly':
                const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
                startOfWeek.setHours(0, 0, 0, 0);
                const endOfWeek = new Date(startOfWeek);
                endOfWeek.setDate(startOfWeek.getDate() + 6);
                endOfWeek.setHours(23, 59, 59, 999);
                dateFilter = {
                    createdOn: { $gte: startOfWeek, $lte: endOfWeek },
                };
                chartDateFilter = { $gte: startOfWeek, $lte: endOfWeek };
                break;
            case 'monthly':
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                endOfMonth.setHours(23, 59, 59, 999);
                dateFilter = {
                    createdOn: { $gte: startOfMonth, $lte: endOfMonth },
                };
                chartDateFilter = { $gte: startOfMonth, $lte: endOfMonth };
                break;
            case 'yearly':
                const startOfYear = new Date(now.getFullYear(), 0, 1);
                const endOfYear = new Date(now.getFullYear(), 11, 31);
                endOfYear.setHours(23, 59, 59, 999);
                dateFilter = {
                    createdOn: { $gte: startOfYear, $lte: endOfYear },
                };
                chartDateFilter = { $gte: startOfYear, $lte: endOfYear };
                break;
            case 'custom':
                if (!startDate || !endDate) {
                    throw new Error('Start date and end date are required for custom filter');
                }
                const start = new Date(startDate);
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
                    throw new Error('Invalid date range');
                }
                dateFilter = {
                    createdOn: { $gte: start, $lte: end },
                };
                chartDateFilter = { $gte: start, $lte: end };
                break;
            default:
                throw new Error('Invalid filter type');
        }

       
        const totalOrdersCount = await Order.countDocuments(dateFilter);

      
        const currentPage = parseInt(page);
        const totalPages = Math.ceil(totalOrdersCount / limit);
        const skip = Math.max(0, (currentPage - 1) * limit);

        
        const orders = await Order.find(dateFilter)
            .populate('user', 'name')
            .populate('orderedItems.product', 'productName')
            .sort({ createdOn: -1 })
            .skip(skip)
            .limit(limit);

        
        const totalUsers = await User.countDocuments({ isAdmin: false });
        const totalProducts = await Product.countDocuments();

       
        const allOrders = await Order.find(dateFilter).populate('orderedItems.product user');

        let totalOrders = totalOrdersCount;
        let totalAmount = 0;
        let totalDiscount = 0;
        let totalCoupons = 0;

        allOrders.forEach(order => {
            if (['Placed', 'Processing', 'Shipped', 'Delivered'].includes(order.status)) {
                totalAmount += order.finalAmount || 0;
                totalDiscount += order.discount || 0;
            }
            if (order.couponApplied) totalCoupons++;
        });

        
        const formattedOrders = orders.map(order => ({
            orderId: order.orderId,
            customerName: order.user ? order.user.name : 'Unknown',
            product: order.orderedItems && order.orderedItems.length > 0
                ? (order.orderedItems[0].product ? order.orderedItems[0].product.productName : 'Unknown Product')
                : 'No Products',
            amount: order.finalAmount || 0,
            status: order.status || 'Unknown',
            date: order.createdOn,
            coupon: order.couponApplied ? order.appliedCoupon || 'Applied' : 'None',
            paymentStatus: order.paymentStatus || 'Unknown'
        }));

        const salesData = {
            orders: formattedOrders,
            totalOrders,
            totalAmount,
            totalDiscount,
            totalCoupons
        };

       
        const previousPeriodFilter = {};
        if (filterType === 'daily') {
            const prevDay = new Date(now);
            prevDay.setDate(now.getDate() - 1);
            previousPeriodFilter.createdOn = {
                $gte: new Date(prevDay.setHours(0, 0, 0, 0)),
                $lte: new Date(prevDay.setHours(23, 59, 59, 999)),
            };
        } else if (filterType === 'weekly') {
            const prevWeekStart = new Date(now.setDate(now.getDate() - now.getDay() - 7));
            prevWeekStart.setHours(0, 0, 0, 0);
            const prevWeekEnd = new Date(prevWeekStart);
            prevWeekEnd.setDate(prevWeekStart.getDate() + 6);
            prevWeekEnd.setHours(23, 59, 59, 999);
            previousPeriodFilter.createdOn = { $gte: prevWeekStart, $lte: prevWeekEnd };
        } else if (filterType === 'monthly') {
            const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
            prevMonthEnd.setHours(23, 59, 59, 999);
            previousPeriodFilter.createdOn = { $gte: prevMonthStart, $lte: prevMonthEnd };
        } else if (filterType === 'yearly') {
            const prevYearStart = new Date(now.getFullYear() - 1, 0, 1);
            const prevYearEnd = new Date(now.getFullYear() - 1, 11, 31);
            prevYearEnd.setHours(23, 59, 59, 999);
            previousPeriodFilter.createdOn = { $gte: prevYearStart, $lte: prevYearEnd };
        } else if (filterType === 'custom') {
            const daysDiff = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24));
            const prevStart = new Date(startDate);
            prevStart.setDate(prevStart.getDate() - daysDiff);
            const prevEnd = new Date(startDate);
            prevEnd.setHours(23, 59, 59, 999);
            previousPeriodFilter.createdOn = { $gte: prevStart, $lte: prevEnd };
        }

        const prevTotalUsers = await User.countDocuments({
            isAdmin: false,
            createdOn: previousPeriodFilter.createdOn
        });
        const prevTotalProducts = await Product.countDocuments({
            createdOn: previousPeriodFilter.createdOn
        });
        const prevOrders = await Order.find(previousPeriodFilter);
        const prevTotalAmount = prevOrders
            .filter(order => ['Placed', 'Processing', 'Shipped', 'Delivered'].includes(order.status))
            .reduce((sum, order) => sum + (order.finalAmount || 0), 0);
        const prevTotalOrders = prevOrders.length;

        const totalUsersGrowth = prevTotalUsers ? ((totalUsers - prevTotalUsers) / prevTotalUsers * 100).toFixed(2) : 0;
        const totalProductsGrowth = prevTotalProducts ? ((totalProducts - prevTotalProducts) / prevTotalProducts * 100).toFixed(2) : 0;
        const totalOrdersGrowth = prevTotalOrders ? ((totalOrders - prevTotalOrders) / prevTotalOrders * 100).toFixed(2) : 0;
        const totalRevenueGrowth = prevTotalAmount ? ((totalAmount - prevTotalAmount) / prevTotalAmount * 100).toFixed(2) : 0;

        
        const chartOrders = await Order.find({
            createdOn: chartDateFilter,
        }).populate('orderedItems.product user');

        let chartData = { labels: [], revenue: [], ordersCount: [] };

        if (filterType === 'daily') {
            const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);
            chartData.labels = hours;
            chartData.revenue = hours.map((_, i) => {
                return chartOrders
                    .filter(order => ['Placed', 'Processing', 'Shipped', 'Delivered'].includes(order.status) && new Date(order.createdOn).getHours() === i)
                    .reduce((sum, order) => sum + (order.finalAmount || 0), 0);
            });
            chartData.ordersCount = hours.map((_, i) => {
                return chartOrders.filter(order => new Date(order.createdOn).getHours() === i).length;
            });
        } else if (filterType === 'weekly') {
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            chartData.labels = days;
            chartData.revenue = days.map((_, i) => {
                return chartOrders
                    .filter(order => ['Placed', 'Processing', 'Shipped', 'Delivered'].includes(order.status) && new Date(order.createdOn).getDay() === i)
                    .reduce((sum, order) => sum + (order.finalAmount || 0), 0);
            });
            chartData.ordersCount = days.map((_, i) => {
                return chartOrders.filter(order => new Date(order.createdOn).getDay() === i).length;
            });
        } else if (filterType === 'monthly') {
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            chartData.labels = Array.from({ length: daysInMonth }, (_, i) => `${i + 1}`);
            chartData.revenue = chartData.labels.map((_, i) => {
                return chartOrders
                    .filter(order => ['Placed', 'Processing', 'Shipped', 'Delivered'].includes(order.status) && new Date(order.createdOn).getDate() === i + 1)
                    .reduce((sum, order) => sum + (order.finalAmount || 0), 0);
            });
            chartData.ordersCount = chartData.labels.map((_, i) => {
                return chartOrders.filter(order => new Date(order.createdOn).getDate() === i + 1).length;
            });
        } else if (filterType === 'yearly') {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            chartData.labels = months;
            chartData.revenue = months.map((_, i) => {
                return chartOrders
                    .filter(order => ['Placed', 'Processing', 'Shipped', 'Delivered'].includes(order.status) && new Date(order.createdOn).getMonth() === i)
                    .reduce((sum, order) => sum + (order.finalAmount || 0), 0);
            });
            chartData.ordersCount = months.map((_, i) => {
                return chartOrders.filter(order => new Date(order.createdOn).getMonth() === i).length;
            });
        } else if (filterType === 'custom') {
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
                    .filter(order => ['Placed', 'Processing', 'Shipped', 'Delivered'].includes(order.status) && new Date(order.createdOn).toISOString().split('T')[0] === label)
                    .reduce((sum, order) => sum + (order.finalAmount || 0), 0);
            });
            chartData.ordersCount = chartData.labels.map(label => {
                return chartOrders.filter(order => new Date(order.createdOn).toISOString().split('T')[0] === label).length;
            });
        }

        
        const productSales = await Order.aggregate([
            { $match: { ...dateFilter, status: { $in: ['Placed', 'Processing', 'Shipped', 'Delivered'] } } },
            { $unwind: '$orderedItems' },
            {
                $group: {
                    _id: '$orderedItems.product',
                    totalSold: { $sum: '$orderedItems.quantity' }
                }
            },
            { $sort: { totalSold: -1 } },
            { $limit: 5 },
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
            name: item.product.productName || 'Unknown',
            totalSold: item.totalSold || 0
        }));

        
        const categorySales = await Order.aggregate([
            { $match: { ...dateFilter, status: { $in: ['Placed', 'Processing', 'Shipped', 'Delivered'] } } },
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
            { $limit: 5 },
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
            name: item.category.name || 'Unknown',
            totalSold: item.totalSold || 0
        }));

       
        res.render("admin/dashboard", {
            currentRoute: 'dashboard',
            errorPage: null,
            errorMessage: null,
            salesData,
            totalUsers,
            totalProducts,
            totalUsersGrowth,
            totalProductsGrowth,
            totalOrdersGrowth,
            totalRevenueGrowth,
            filterType,
            startDate: startDate || (dateFilter.createdOn?.$gte?.toISOString().split('T')[0]),
            endDate: endDate || (dateFilter.createdOn?.$lte?.toISOString().split('T')[0]),
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
                console.error("Error destroying session", err);
                return res.redirect("/pageerror");
            }
            res.redirect("/admin/login");
        });
    } catch (error) {
        console.error("Unexpected error during logout", error);
        res.redirect("/pageerror");
    }
};

const getSalesReport = async (req, res) => {
    try {
        const { filterType = 'daily', startDate, endDate } = req.query;

        let dateFilter = {};
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

        switch (filterType) {
            case 'daily':
                dateFilter = {
                    createdOn: {
                        $gte: new Date(now.setHours(0, 0, 0, 0)),
                        $lte: new Date(now.setHours(23, 59, 59, 999)),
                    },
                };
                break;
            case 'weekly':
                const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
                startOfWeek.setHours(0, 0, 0, 0);
                const endOfWeek = new Date(startOfWeek);
                endOfWeek.setDate(startOfWeek.getDate() + 6);
                endOfWeek.setHours(23, 59, 59, 999);
                dateFilter = {
                    createdOn: { $gte: startOfWeek, $lte: endOfWeek },
                };
                break;
            case 'monthly':
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                endOfMonth.setHours(23, 59, 59, 999);
                dateFilter = {
                    createdOn: { $gte: startOfMonth, $lte: endOfMonth },
                };
                break;
            case 'yearly':
                const startOfYear = new Date(now.getFullYear(), 0, 1);
                const endOfYear = new Date(now.getFullYear(), 11, 31);
                endOfYear.setHours(23, 59, 59, 999);
                dateFilter = {
                    createdOn: { $gte: startOfYear, $lte: endOfYear },
                };
                break;
            case 'custom':
                if (!startDate || !endDate) {
                    throw new Error('Start date and end date are required for custom filter');
                }
                dateFilter = {
                    createdOn: {
                        $gte: new Date(startDate),
                        $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)),
                    },
                };
                break;
            default:
                throw new Error('Invalid filter type');
        }

        const orders = await Order.find(dateFilter)
            .populate('user', 'name')
            .populate('orderedItems.product', 'productName')
            .sort({ createdOn: -1 });

        const totalOrders = orders.length;
        const totalAmount = orders
            .filter(order => ['Placed', 'Processing', 'Shipped', 'Delivered'].includes(order.status))
            .reduce((sum, order) => sum + (order.finalAmount || 0), 0);
        const totalDiscount = orders
            .filter(order => ['Placed', 'Processing', 'Shipped', 'Delivered'].includes(order.status))
            .reduce((sum, order) => sum + (order.discount || 0), 0);
        const totalCoupons = orders.filter(order => order.couponApplied).length;

        const salesData = {
            orders: orders.map(order => ({
                orderId: order.orderId,
                customerName: order.user ? order.user.name : 'Unknown',
                product: order.orderedItems && order.orderedItems.length > 0
                    ? (order.orderedItems[0].product ? order.orderedItems[0].product.productName : 'Unknown Product')
                    : 'No Products',
                amount: order.finalAmount || 0,
                status: order.status || '',
                date: order.createdOn,
                coupon: order.couponApplied ? order.appliedCoupon || 'Applied' : 'None',
                paymentStatus: order.paymentStatus || 'Unknown'
            })),
            totalOrders,
            totalAmount,
            totalDiscount,
            totalCoupons
        };

        res.render('admin/sales-report', {
            salesData,
            filterType,
            startDate,
            endDate,
            errorMessage: null
        });
    } catch (error) {
        console.error("Error loading sales report:", error);
        res.render('error', {
            salesData: null,
            filterType,
            startDate,
            endDate,
            errorMessage: 'Failed to load sales data: ' + error.message
        });
    }
};

const downloadReport = async (req, res) => {
    try {
        const { format, filterType = 'daily', startDate, endDate } = req.query;

        let start, end;
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

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
                if (!startDate || !endDate) throw new Error('Start and end date are required for custom filter');
                start = new Date(startDate);
                end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                break;
            default:
                throw new Error('Invalid filter type');
        }

        const orders = await Order.find({
            createdOn: { $gte: start, $lte: end },
            status: 'Delivered',
            paymentStatus: 'Paid'
        }).populate('user', 'name');

        let totalOrders = orders.length;
        let totalAmount = 0;
        let totalDiscount = 0;
        let totalCoupons = 0;

        orders.forEach(order => {
            totalAmount += order.finalAmount || 0;
            totalDiscount += order.discount || 0;
            if (order.couponApplied) totalCoupons++;
        });

        if (format === 'pdf') {
            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=sales-report-${filterType}.pdf`);
            doc.pipe(res);

            // Header
            doc.fontSize(22).fillColor('#333').text('Sales Report', { align: 'center' }).moveDown(0.5);
            doc.fontSize(12).fillColor('#666');
            doc.text(`Report Period: ${filterType.toUpperCase()}`, { align: 'center' });
            if (filterType === 'custom') {
                doc.text(`From: ${start.toLocaleDateString()} To: ${end.toLocaleDateString()}`, { align: 'center' });
            }
            doc.text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
            doc.moveDown(1);

            // Summary Line
            doc.fontSize(11).fillColor('#444');
            const summaryY = doc.y;
            doc.text(`Total Orders: ${totalOrders}`, 50, summaryY);
            doc.text('Total Amount: ₹' + totalAmount.toFixed(2), 200, summaryY);
            doc.text('Total Discount: ₹' + totalDiscount.toFixed(2), 350, summaryY);
            doc.text(`Coupons Used: ${totalCoupons}`, 500, summaryY);
            doc.moveDown(1.5);

            // Table Headers
            const tableTop = doc.y;
            const itemHeight = 20;
            const tableHeaders = [
                { title: 'Order ID', x: 50, width: 80 },
                { title: 'Customer', x: 130, width: 80 },
                { title: 'Date', x: 210, width: 70 },
                { title: 'Amount', x: 280, width: 60 },
                { title: 'Discount', x: 340, width: 60 },
                { title: 'Status', x: 400, width: 70 },
                { title: 'Payment', x: 470, width: 70 }
            ];

            doc.rect(50, tableTop, 490, itemHeight).fill('#4472C4');
            doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10);
            tableHeaders.forEach(header => {
                doc.text(header.title, header.x + 5, tableTop + 6, {
                    width: header.width - 10
                });
            });

            let currentY = tableTop + itemHeight;
            const pageHeight = doc.page.height - 100;

            orders.forEach((order, index) => {
                if (currentY > pageHeight) {
                    doc.addPage();
                    currentY = 50;
                    doc.rect(50, currentY, 490, itemHeight).fill('#4472C4');
                    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10);
                    tableHeaders.forEach(header => {
                        doc.text(header.title, header.x + 5, currentY + 6, {
                            width: header.width - 10
                        });
                    });
                    currentY += itemHeight;
                }

                const rowColor = index % 2 === 0 ? '#f8f9fa' : '#ffffff';
                doc.rect(50, currentY, 490, itemHeight).fill(rowColor).stroke('#ddd');

                doc.font('Helvetica').fontSize(9).fillColor('#333');
                const rowData = [
                    { text: order.orderId || 'N/A', x: 50, width: 80 },
                    { text: order.user ? order.user.name : 'Unknown', x: 130, width: 80 },
                    { text: new Date(order.createdOn).toLocaleDateString(), x: 210, width: 70 },
                    { text: '₹' + (order.finalAmount || 0).toFixed(2), x: 280, width: 60 },
                    { text: '₹' + (order.discount || 0).toFixed(2), x: 340, width: 60 },
                    { text: order.status, x: 400, width: 70 },
                    { text: order.paymentStatus, x: 470, width: 70 }
                ];
                rowData.forEach(cell => {
                    doc.text(cell.text, cell.x + 5, currentY + 6, {
                        width: cell.width - 10,
                        ellipsis: true
                    });
                });

                currentY += itemHeight;
            });

            doc.end();
        }

        else if (format === 'excel') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Sales Report');

            worksheet.columns = [
                { header: 'Order ID', key: 'orderId', width: 20 },
                { header: 'Customer', key: 'customer', width: 20 },
                { header: 'Date', key: 'date', width: 15 },
                { header: 'Amount (₹)', key: 'amount', width: 15 },
                { header: 'Discount (₹)', key: 'discount', width: 15 },
                { header: 'Coupon', key: 'coupon', width: 15 },
                { header: 'Status', key: 'status', width: 15 },
                { header: 'Payment Status', key: 'paymentStatus', width: 15 }
            ];

            worksheet.getRow(1).font = { bold: true };

            orders.forEach(order => {
                worksheet.addRow({
                    orderId: order.orderId,
                    customer: order.user ? order.user.name : 'Unknown',
                    date: new Date(order.createdOn).toLocaleDateString(),
                    amount: (order.finalAmount || 0).toFixed(2),
                    discount: (order.discount || 0).toFixed(2),
                    coupon: order.couponApplied ? (order.appliedCoupon || 'Applied') : 'None',
                    status: order.status,
                    paymentStatus: order.paymentStatus
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
        }

        else {
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