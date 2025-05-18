const mongoose = require("mongoose");
const { Schema } = mongoose;
const { v4: uuidv4 } = require('uuid');

const orderSchema = new Schema({
    orderId: {
        type: String,
        default: () => uuidv4(),
        unique: true
    },
    orderedItems: [{
        product: {
            type: Schema.Types.ObjectId,
            ref: "product",
            required: true
        },
        quantity: {
            type: Number,
            required: true
        },
        price: {
            type: Number,
            default: 0
        }
    }],
    cancelledItems: [{
        product: {
            type: Schema.Types.ObjectId,
            ref: "product",
            required: true
        },
        quantity: {
            type: Number,
            required: true
        },
        price: {
            type: Number,
            default: 0
        },
        cancelReason: {
            type: String
        },
        cancelledAt: {
            type: Date,
            default: Date.now
        }
    }],
    totalPrice: {
        type: Number,
        required: true
    },
    discount: {
        type: Number,
        default: 0
    },
    finalAmount: {
        type: Number,
        required: true
    },
    address: {
        type: Schema.Types.ObjectId,
        ref: 'Address',
        required: true
    },
    user: { 
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    invoiceDate: {
        type: Date
    },
    status: {
        type: String,
        required: true,
        enum: ['Pending', 'Placed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Return Request', 'Return Denied', 'Returned']
    },
    createdOn: {
        type: Date,
        default: Date.now,
        required: true
    },
    couponApplied: {
        type: Boolean,
        default: false
    },
    paymentMethod: { 
        type: String,
        required: true,
        enum: ['COD', 'razorpay']
    },
    paymentStatus: {
        type: String,
        enum: ['Pending', 'Paid', 'Failed'],
        default: 'Pending'
    },
    razorpayPaymentId: {
        type: String
    },
    paymentError: {
        type: String
    },
    cancelReason: {
        type: String
    },
    returnReason: {
        type: String
    },
    returnRequested: {
        type: Boolean,
        default: false
    },
    returnStatus: {
        type: String,
        enum: ['Pending', 'Approved', 'Denied', null],
        default: null
    },
    returnRequestDate: {
        type: Date
    },
    returnDate: {
        type: Date
    },
    returnDenyReason: {
        type: String
    }
});

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;