const express = require("express");  
const msal = require("@azure/msal-node"); // msal node can be used to authenticate users and request tokens from Azure Entra ID 
const jwt = require("jsonwebtoken"); // JSON Web Token (JWT) is a compact简洁的, URL-safe means of representing claims to be transferred between two parties.
const session = require("express-session"); // express-session is a middleware that allows us to store user data between HTTP requests.
require("dotenv").config(); // dotenv is a zero-dependency module that loads environment variables from a .env file into process.env.
                            // process.env is a global variable that contains all the environment variables that were set when the process was started.

// Create MSAL configuration object
const msalConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  },
  system: {
    loggerOptions: {
      loggerCallback(loglevel, message, containsPii) {
        console.log(message); // this message shows what is happening in the background when you run the app, i.e. the token being decoded
      },
      piiLoggingEnabled: false, // Personally Identifiable Information (PII) is any data that could potentially identify a specific individual, i.e. name, email, phone number, etc. False means that the app will not log PII. why not true? Because it is a security risk.
      logLevel: msal.LogLevel.Verbose, // Verbose means that the app will log everything, what if we set it to "info"? It will only log info and above, i.e. info, warning, error, and critical.
    },
  },
};

// Create msal application object
const pca = new msal.ConfidentialClientApplication(msalConfig); // ConfidentialClientApplication is a class that represents a public client application that can be used to authenticate users and request tokens from Azure Entra ID

// Create Express App and set view engine as EJS
const app = express();

// Enable sessions
app.use(
    session({
      secret: "your_secret", // Replace with a real secret when deploying to production environment
      resave: false, // false means that the session will not be saved in the session store unless the session is modified, i.e. the user is authenticated
      saveUninitialized: true, // true means that the session will be stored in the session store even if the session is not modified, i.e. the user is not authenticated
      cookie: { secure: false }, // Set to true if using https
    })
);
/*
resave: false：这个选项控制的是已经存在的session。当一个session已经存在，且在一次请求中没有被修改（即没有新的数据被添加到session中），那么这个session是否应该被重新保存到session存储中？如果resave设置为false，那么这个未修改的session将不会被重新保存。
saveUninitialized: true：这个选项控制的是新的session。当一个session是新创建的，且在一次请求中没有被修改（即没有数据被添加到session中），那么这个session是否应该被保存到session存储中？如果saveUninitialized设置为true，那么这个新的但未修改的session将会被保存。
*/

// Main page route
app.get("/", (req, res) => {
  if (req.session.isAuthenticated) { // isAuthenticated comes from the session middleware, which is a boolean that indicates whether the user is authenticated or not
    // User is authenticated, show profile
    res.render("index", { isAuthenticated: true, user: req.session.user }); // index means index.ejs, which is the main page of the app
  } else {
    // User is not authenticated, show sign-in button
    res.render("index", { isAuthenticated: false, user: null }); 
  }
});

// Redirect to Azure Entra ID login page
app.get("/login", async (req, res) => {
  try {
    const authCodeUrlParameters = { // authCodeUrlParameters is an object that contains the parameters for the authorization code url
      scopes: ["user.read"], // scopes is an array of scopes that you want to request from the user, i.e. user.read, user.write, etc. user.read means that you want to read the user's profile information from Azure Entra ID
      redirectUri: process.env.DEV_REDIRECT_URI, // Azure Entra ID will redirect to after the user has signed in and consented to your app
      /*
//     此处的redirectUri 是用于构建授权URL的一部分，这个URL将用户重定向到 Azure AD 进行身份验证和授权。在用户同意授权后，Azure AD 将用户重定向回 redirectUri 指定的URL，并在查询参数中附带授权码。
//     */
    };
    // Get URL to sign users in and consent to your app 
    const loginUrl = await pca.getAuthCodeUrl(authCodeUrlParameters); // getAuthCodeUrl(authCodeUrlParameters) is a method that returns a promise that resolves to a URL that contains an authorization code value that can be exchanged for an access token; the authorization code is something that Azure Entra ID will send to your app after the user has signed in and consented to your app, and your app will then exchange the authorization code for an access token, which can be used to access the user's profile information, i.e. name, email, phone number, etc.
    res.redirect(loginUrl);  // Redirect to Azure Entra ID login page with authorization code in the URL
  } catch (error) {
    console.error(error);
    res.status(500).send("Error building auth code URL");
  }
});

// Handle Azure Entra redirect with authorization code and exchange for access token to get user's profile information from Azure Entra ID 
app.get("/redirect", async (req, res) => {
  const tokenRequest = {
    code: req.query.code, // req.query.code is the authorization code that Azure Entra ID sent to your app after the user has signed in and consented to your app
    scopes: ["user.read"],
    redirectUri: process.env.DEV_REDIRECT_URI,
    /* 
    此处的redirectUri 是用于构建令牌请求的一部分，这个请求将发送到 Azure AD 的令牌端点以交换授权码。在这个请求中，redirectUri 必须与原始授权请求中使用的 redirectUri 相匹配，否则令牌请求将失败。
    */
  };

  try {
    const response = await pca.acquireTokenByCode(tokenRequest); // acquireTokenByCode(tokenRequest) is a method that returns a promise that resolves to an AuthenticationResult object that contains an access token that can be used to access the user's profile information from Azure Entra ID
    req.session.isAuthenticated = true; // Set isAuthenticated to true to indicate that the user is authenticated and can access the main page of the app
    req.session.user = jwt.decode(response.accessToken);
    console.log("Decoded access Token:", req.session.user); // Print the decoded access token to the terminal console for check tokens in the background when you run the app
    res.redirect("/"); // Redirect to main page
  } catch (error) {
    console.error(error);
    if (error.name === "ClientAuthError") {
      res.status(401).send("Authentication failed. Please try to login again.");
    } else {
      res.status(500).send("Error acquiring token");
    }
  }
});

// // Profile route
// app.get("/profile", (req, res) => {
//   const token = req.query.token; // req.query.token is the access token that your app received from Azure Entra ID after the user has signed in and consented to your app
//   if (token) { // If the user is authenticated, show profile 
//     // Decode the token to get the user's profile information
//     const decodedToken = jwt.decode(token);
//     res.render("profile", { user: decodedToken }); 
//   } else {
//     res.redirect("/login"); // Redirect to Azure Entra ID login page if the user is not authenticated 
//   }
// });

// Sign out route
app.get("/signout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error during sign out.");
    }

    // Determine the post logout redirect URI based on the environment
    const postLogoutRedirectUri = process.env.DEV_URI;  // postLogoutRedirectUri is the URL that Azure Entra ID will redirect to after the user has signed out of your app

    // Redirect to Azure Entra ID logout URL
    const tenantId = process.env.AZURE_TENANT_ID;
    const logoutUri = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/logout?post_logout_redirect_uri=${postLogoutRedirectUri}`;
    res.redirect(logoutUri);
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));


// Reference: https://github.com/ariyaHub/ms-identity-node/blob/main/index.js
//            https://medium.com/@ariyakluankloi/quickstart-sign-in-users-and-get-an-access-token-in-a-node-web-app-using-the-auth-code-flow-81e74492741e