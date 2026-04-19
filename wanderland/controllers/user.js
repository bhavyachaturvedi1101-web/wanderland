const User = require("../models/user.js");
const { sendOTP } = require("../util/email.js");
const otpGenerator = require("otp-generator");

//Signup logic
module.exports.PostUser = async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const newUser = new User({ email, username });
       const registeredUser = await User.register(newUser, password);

        // Generate OTP
        const otp = otpGenerator.generate(6, { upperCaseAlphabets: false, lowerCaseAlphabets: false, specialChars: false });
        registeredUser.otp = otp;
        registeredUser.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        await registeredUser.save();

        // Send OTP email
        await sendOTP(registeredUser.email, otp);

        // Log OTP for development testing
        if (process.env.NODE_ENV !== 'production') {
            console.log(`\n=== SIGNUP OTP ===`);
            console.log(`Email: ${registeredUser.email}`);
            console.log(`OTP: ${otp}`);
            console.log(`Expires: ${registeredUser.otpExpires}`);
            console.log(`==================\n`);
        }

        // Store email in session for OTP verification
        req.session.pendingVerificationEmail = registeredUser.email;

        req.flash("success", "OTP sent to your email. Please verify to complete signup.");
        res.redirect("/verify-otp");
    } catch (error) {
        console.error('Signup error:', error);
        req.flash("error", error.message);
        res.redirect("/signup");
    }
};

module.exports.LoginUser = async (req, res, next) => {
    try {
        // 1. Capture user info BEFORE logging out
        const user = req.user;
        const userEmail = user.email;
        const isVerified = user.isVerified;

        // 2. Generate and Save OTP
        const otp = otpGenerator.generate(6, { upperCaseAlphabets: false, lowerCaseAlphabets: false, specialChars: false });
        user.otp = otp;
        user.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        await user.save();
        
        // 3. Send Email
        await sendOTP(userEmail, otp);

        // 4. Logout to prevent access until OTP verified
        req.logout((err) => {
            if (err) {
                return next(err);
            }

            // 5. Re-establish session context for verification
            req.session.pendingVerificationEmail = userEmail;

            if (isVerified) {
                // Verified user -> 2FA Login Mode
                req.session.pendingLoginVerification = true;
                req.flash("success", "OTP sent. Please verify to complete login.");
            } else {
                // Unverified user -> Signup Verification Mode
                req.flash("error", "Email not verified. A new OTP has been sent.");
            }

            // 6. FORCE SAVE session before redirecting
            // This prevents the "Session expired" error on the OTP page
            req.session.save((err) => {
                if (err) {
                    console.error("Session save error:", err);
                    return next(err);
                }
                res.redirect("/verify-otp");
            });
        });

    } catch (error) {
        console.error("Login Error:", error);
        req.flash("error", "Something went wrong. Please try again.");
        res.redirect("/login");
    }
};
//Logout logic
module.exports.LogoutUser = (req, res, next) => {
    req.logout(function(err) {
        if (err) {
            req.flash("error", "Logout failed");
            return res.redirect("/listings");
        }
        req.flash("success", "Logged you out!");
        res.redirect("/listings");
      });
}

//Forgot password logic
module.exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            req.flash("error", "No account with that email address exists.");
            return res.redirect("/forgot-password");
        }

        // Set session for password reset
        req.session.pendingVerificationEmail = user.email;

        req.flash("success", "Please set your new password.");
        res.redirect("/reset-password");
    } catch (error) {
        console.error('Forgot password error:', error);
        req.flash("error", "Failed to process request. Please try again.");
        res.redirect("/forgot-password");
    }
}

//Reset password logic
module.exports.resetPassword = async (req, res) => {
    try {
        const { password } = req.body;
        const email = req.session.pendingVerificationEmail;
        if (!email) {
            req.flash("error", "Session expired. Please try again.");
            return res.redirect("/forgot-password");
        }

        const user = await User.findOne({ email });
        if (!user) {
            req.flash("error", "User not found.");
            return res.redirect("/forgot-password");
        }

        // Update password
        await user.setPassword(password);
        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();

        // Clear session
        delete req.session.pendingPasswordReset;
        delete req.session.pendingVerificationEmail;

        req.flash("success", "Password reset successfully. Please log in with your new password.");
        res.redirect("/login");
    } catch (error) {
        console.error('Reset password error:', error);
        req.flash("error", "Failed to reset password. Please try again.");
        res.redirect("/reset-password");
    }
}
