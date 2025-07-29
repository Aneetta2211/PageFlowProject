const mongoose = require("mongoose");
const { Schema } = mongoose;

const orderSchema = new Schema({
    orderId: {
        type: String,
        required: true,
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
        },
        discountApplied: {
            type: Number,
            default: 0
        },
        deliveryDate: {
            type: Date
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
        discountApplied: {
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
    returnedItems: [{ 
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
        discountApplied: {
            type: Number,
            default: 0
        },
        returnReason: {
            type: String
        },
        returnStatus: {
            type: String,
            enum: ['Pending', 'Approved', 'Denied'],
            default: 'Pending'
        },
        returnRequestDate: {
            type: Date,
            default: Date.now
        },
        returnDate: {
            type: Date
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
    shipping: {
        type: Number,
        default: 49.00
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
        enum: ['Pending', 'Placed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Return Request', 'Return Denied', 'Returned', 'Payment Failed']
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
    appliedCoupon: {
        type: String,
        default: null
    },
    paymentMethod: {
        type: String,
        required: true,
        enum: ['COD', 'razorpay', 'wallet']
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
    },
    refundedAmount: {
        type: Number,
        default: 0
    }
});

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;