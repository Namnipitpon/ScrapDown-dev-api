//  import libraries
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as bcrypt from 'bcrypt';
import * as nodemailer from 'nodemailer';
import * as cors from 'cors';

//  initialize firebase inorder to access its services
admin.initializeApp(functions.config().firebase);

//  initialize express server
const app = express();
const main = express();

// Apply CORS middleware
app.use(cors({ origin: true }));

//  add the path to receive request and set json as bodyParser to process the body
main.use('/api/v1', app);
main.use(bodyParser.json());
main.use(bodyParser.urlencoded({ extended: false }));

//  initialize the database and the collection
const db = admin.firestore();
const userCollection = 'users';
const credentialsCollection = 'credentials';
const matchesDataCollection = 'matchesData';
const itemCollection = db.collection('items');
const monsterCollection = 'monsterData'

//  define google cloud function name
export const webApi = functions.https.onRequest(main);

interface User {
  title : string;
  playerName: string;
  playerNameLower: string;
  exp: number;
  pilotActive: string;
  spaceshipActive: string;
  inventory: {
    pilot: string[];
    spaceship: string[];
  };
  battlePass: number;
  achievement: string[];
  currency: {
     diamond: number ,
     coin: number 
  },
  playerList : {
     friend: string[] ,
     request: string[] ,
     block: string[]
  },
  playingInformation: object | null;
  email: string
  isConfirmed: boolean
}

// -------------------------------------------------------- [ User ] ----------------------------------------------------------

// Register 
app.post('/user/register', async (req, res) => {
  try {
    const { email, password, confirmPassword } = req.body;

    if (!email || !password || !confirmPassword) {
      return res.status(400).json({ status: 'error', message: 'Email, password, or confirmPassword is not defined' });
    }

    // Check if passwords match
    if (password !== confirmPassword) {
      return res.status(400).json({ status: 'error', message: 'Passwords do not match' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    let token;
    let tokenSnapshot;
    const tokenRef = db.collection(credentialsCollection);
    do {
      token = generateRandomString(13);
      tokenSnapshot = await tokenRef.where('token', '==', token).get();
    } while (!tokenSnapshot.empty);

    // Save user credentials in the "credentials" collection
    const result = await createUser(email, hashedPassword, token);

    if (result.status === 'failed') {
      return res.status(400).json(result);
    }

    // Check if userId is defined before calling setUserDetails
    const { userId } = result;

    if (userId) {
      // Set user details
      const userDetailsResult = await setUserDetails(userId, email);

      if (userDetailsResult.status === 'failed') {
        // Handle the case where setting user details fails
        return res.status(400).json(userDetailsResult);
      }

      // Send confirmation email
      await sendConfirmationEmail(email, token);

      return res.status(201).json({ status: 'success', message: 'User registered and confirmation email sent successfully' });
    } else {
      // Handle the case where userId is undefined
      console.error('User ID is undefined');
      return res.status(500).json({ status: 'error', message: 'Internal server error during user registration' });
    }
  } catch (error) {
    console.error('Error registering user:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error during user registration' });
  }
});

// Platform Register 
app.post('/user/platform-register', async (req, res) => {
  try {
    const {userId, email, platform, platformId } = req.body;

    if (!userId || !email || !platform || !platformId) {
      return res.status(400).json({ status: 'error', message: 'Email ,name ,userId or platform is not defined' });
    }

    // Check if the userId exists in the database
    const userDoc = await db.collection(userCollection).doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Save user credentials in the "credentials" collection
    const result = await createUserWithPlatform(userId, email, platform.toLowerCase(), platformId);

    if (result.status === 'failed') {
      return res.status(400).json(result);
    }

    if (!result.userId) {
      // Handle the case where userId is undefined
      console.error('User ID is undefined');
      return res.status(500).json({ status: 'error', message: 'Internal server error during user registration' });
    }

    return res.status(201).json({ status: 'success', message: 'Account linked to platform successfully' });
  } catch (error) {
    console.error('Error registering user:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error during user registration' });
  }
});

// Guest Register 
app.post('/user/guest-register', async (req, res) => {
  try {
    const { userId, email, password, confirmPassword } = req.body;

    if (!userId || !email || !password || !confirmPassword) {
      return res.status(400).json({ status: 'error', message: 'userId, email, password, or confirmPassword is not defined' });
    }

    // Check if passwords match
    if (password !== confirmPassword) {
      return res.status(400).json({ status: 'error', message: 'Passwords do not match' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    let token;
    let tokenSnapshot;
    const tokenRef = db.collection(credentialsCollection);
    do {
      token = generateRandomString(13);
      tokenSnapshot = await tokenRef.where('token', '==', token).get();
    } while (!tokenSnapshot.empty);

    // Save user credentials in the "credentials" collection
    const result = await createUserGuest(userId, email, hashedPassword, token);

    if (result.status === 'failed') {
      return res.status(400).json(result);
    }

    // Send confirmation email
    await sendConfirmationEmail(email, token);

    // Update the email in the user collection
    const userRef = db.collection(userCollection).doc(userId);
    await userRef.update({ email });

    return res.status(201).json({ status: 'success', message: 'User registered and confirmation email sent successfully' });
  } catch (error) {
    console.error('Error registering user:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error during user registration' });
  }
});

// Guest Login
app.post('/user/guest-login', async (req, res) => {
  try {
    const currentTime = new Date();
    currentTime.setHours(currentTime.getHours() + 7);

    // Set data for the guest user
    const result = await setUserDetails('', '');

    if (result.status === 'success') {
      // Get guest user data after setting details
      const guestUserId = result.userId;

      if (guestUserId) {
        const guestUserDoc = await db.collection(userCollection).doc(guestUserId).get();
        const guestUserData = guestUserDoc.data();

        // Format the login time
        const month = (currentTime.getMonth() + 1).toString().padStart(2, '0');
        const date = currentTime.getDate().toString().padStart(2, '0');
        const year = currentTime.getFullYear();
        const hours = currentTime.getHours().toString().padStart(2, '0');
        const minutes = currentTime.getMinutes().toString().padStart(2, '0');
        const seconds = currentTime.getSeconds().toString().padStart(2, '0');
        const milliseconds = currentTime.getMilliseconds().toString().padStart(3, '0');
        const loginTime = `${month}/${date}/${year} ${hours}:${minutes}:${seconds}.${milliseconds}`;

        return res.status(200).json({ status: 'success', message: 'Guest login successful', data: { userId: guestUserId, ...guestUserData, loginTime: loginTime} });
      } else {
        // Handle the case where guestUserId is undefined
        return res.status(500).json({ status: 'error', message: 'Internal server error during guest login' });
      }
    }

    // Handle other failure cases
    return res.status(500).json({ status: 'error', message: 'Internal server error during guest login' });
  } catch (error) {
    console.error('Error during guest login:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error during guest login' });
  }
});

// Login
app.post('/user/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const currentTime = new Date();
    currentTime.setHours(currentTime.getHours() + 7);

    if (!email || !password) {
      return res.status(400).json({ status: 'error', message: 'Email or password is not defined' });
    }

    // Convert the provided email to lowercase for case-insensitive comparison
    const lowercaseEmail = email.toLowerCase();

    const credentialsRef = db.collection(credentialsCollection);
    const idQuery = credentialsRef.where('platform.email', '==', lowercaseEmail);
    const idSnapshot = await idQuery.get();

    if (idSnapshot.empty) {
      return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
    }
    
    // Assuming there's only one user with a given ID
    const credentialsData = idSnapshot.docs[0].data();
    const isValidPassword = await bcrypt.compare(password, credentialsData.hashedPassword);

    if (!isValidPassword) {
      return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
    }

    // Successful login
    const userRef = db.collection(userCollection);
    const userQuery = userRef.doc(idSnapshot.docs[0].id);
    const userDoc = await userQuery.get();

    if (!userDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const userData = userDoc.data();

    if (!userData) {
      console.log('User data is undefined');
      return res.status(500).json('Internal server error');
    }

    // Format the login time
    const month = (currentTime.getMonth() + 1).toString().padStart(2, '0');
    const date = currentTime.getDate().toString().padStart(2, '0');
    const year = currentTime.getFullYear();
    const hours = currentTime.getHours().toString().padStart(2, '0');
    const minutes = currentTime.getMinutes().toString().padStart(2, '0');
    const seconds = currentTime.getSeconds().toString().padStart(2, '0');
    const milliseconds = currentTime.getMilliseconds().toString().padStart(3, '0');
    const loginTime = `${month}/${date}/${year} ${hours}:${minutes}:${seconds}.${milliseconds}`;

    if (userData.dailyLogin) {
      const currentDateTime = new Date().toLocaleString('en-US', {timeZone: 'Asia/Bangkok'}); // Adjusted for Thai timezone
      const currentDate = new Date(currentDateTime);
      const currentHour = currentDate.getHours();
      const timeUntilNextLogin = calculateTimeUntilNextLogin(new Date(userData.dailyLogin.lastLogin), currentHour);
      userData.dailyLogin.timeUntilNextLogin = timeUntilNextLogin
    }

    // Check if request, block, and friend arrays are all empty
    if (userData.playerList.request.length === 0 && userData.playerList.block.length === 0 && userData.playerList.friend.length === 0) {
      return res.status(200).json({ status: 'success', message: 'Login successful', data: { userId: userDoc.id, ...userData, platform: credentialsData.platform , loginTime: loginTime} });
    } else {
      console.log('At least one array is not empty');
      // Get the friend list from user data
      const playerList = userData.playerList || [];

      // Create the desired structure for playerList
      const formattedPlayerList = [
        { type: 'friend', users: playerList.friend || [] },
        { type: 'request', users: playerList.request || [] },
        { type: 'block', users: playerList.block || [] },
      ];

      // Get user details for each user ID in playerList
      const userDetails = await getUserDetailsByIds(formattedPlayerList);

      const formattedPlayerListResponse: { [key: string]: unknown } = {};

      formattedPlayerList.forEach((list) => {
        formattedPlayerListResponse[list.type] = userDetails
          .filter((user) => list.users.includes(user.userId))
          .map((user) => ({
            userId: user.userId,
            playerName: user.playerName,
            pilotActive: user.pilotActive,
          }));
      });
      return res.status(200).json({
        status: 'success',
        message: 'User Login successful',
        data: { userId: userDoc.id, ...userData, platform: credentialsData.platform, playerList: formattedPlayerListResponse, loginTime: loginTime},
      });
    }

  } catch (error) {
    console.error('Error during login:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error during login' });
  }
});

// Login With Platform
app.post('/user/login-platform-account', async (req, res) => {
  try {
    const { email, platform, platformId } = req.body;

    if (!platformId || !platform) {
      return res.status(400).json({ status: 'error', message: 'PlatformId or platform is not defined' });
    }
    
    if (platform.toLowerCase() !== 'apple' && !email) {
      return res.status(400).json({ status: 'error', message: 'Email is not defined' });
    }

    const currentTime = new Date();
    currentTime.setHours(currentTime.getHours() + 7);
  
    // Format the login time
    const month = (currentTime.getMonth() + 1).toString().padStart(2, '0');
    const date = currentTime.getDate().toString().padStart(2, '0');
    const year = currentTime.getFullYear();
    const hours = currentTime.getHours().toString().padStart(2, '0');
    const minutes = currentTime.getMinutes().toString().padStart(2, '0');
    const seconds = currentTime.getSeconds().toString().padStart(2, '0');
    const milliseconds = currentTime.getMilliseconds().toString().padStart(3, '0');
    const loginTime = `${month}/${date}/${year} ${hours}:${minutes}:${seconds}.${milliseconds}`;

    // Query the credentials collection where platform matches the provided email
    const credentialsRef = db.collection(credentialsCollection);
    const query = credentialsRef.where(`platformId.${platform.toLowerCase()}`, '==', platformId);
    const querySnapshot = await query.get();

    if (!querySnapshot.empty) {

      // Successful login
      const userRef = db.collection(userCollection);
      const userQuery = userRef.doc(querySnapshot.docs[0].id);
      const userDoc = await userQuery.get();

      if (!userDoc.exists) {
        return res.status(404).json({ status: 'error', message: 'User not found' });
      }

      const userData = userDoc.data();

      if (!userData) {
        console.log('User data is undefined');
        return res.status(500).json('Internal server error');
      }

      const credentialsDoc = await db.collection(credentialsCollection).doc(querySnapshot.docs[0].id).get();

      if (!credentialsDoc.exists) {
        return res.status(404).json({ status: 'error', message: 'credentialsDoc not found' });
      }
    
      const platformData = credentialsDoc.data();

      if (!platformData) {
        console.log('credentialsDoc data is undefined');
        return res.status(500).json('Internal server error');
      }

      if (userData.dailyLogin) {
        const currentDateTime = new Date().toLocaleString('en-US', {timeZone: 'Asia/Bangkok'}); // Adjusted for Thai timezone
        const currentDate = new Date(currentDateTime);
        const currentHour = currentDate.getHours();
        const timeUntilNextLogin = calculateTimeUntilNextLogin(new Date(userData.dailyLogin.lastLogin), currentHour);
        userData.dailyLogin.timeUntilNextLogin = timeUntilNextLogin
      }

      // Check if request, block, and friend arrays are all empty
      if (userData.playerList.request.length === 0 && userData.playerList.block.length === 0 && userData.playerList.friend.length === 0) {
        return res.status(200).json({ status: 'success', message: 'Login successful', data: { userId: userDoc.id, ...userData, platform: platformData.platform, loginTime: loginTime} });
      } else {
        console.log('At least one array is not empty');
        // Get the friend list from user data
        const playerList = userData.playerList || [];

        // Create the desired structure for playerList
        const formattedPlayerList = [
          { type: 'friend', users: playerList.friend || [] },
          { type: 'request', users: playerList.request || [] },
          { type: 'block', users: playerList.block || [] },
        ];

        // Get user details for each user ID in playerList
        const userDetails = await getUserDetailsByIds(formattedPlayerList);

        const formattedPlayerListResponse: { [key: string]: unknown } = {};

        formattedPlayerList.forEach((list) => {
          formattedPlayerListResponse[list.type] = userDetails
            .filter((user) => list.users.includes(user.userId))
            .map((user) => ({
              userId: user.userId,
              playerName: user.playerName,
              pilotActive: user.pilotActive,
            }));
        });
        return res.status(200).json({
          status: 'success',
          message: 'User Login successful',
          data: { userId: userDoc.id, ...userData, playerList: formattedPlayerListResponse, platform: platformData, loginTime: loginTime},
        });
      }
    } else {
      // Save user credentials in the "credentials" collection
      const result = await createUserWithPlatform('register', email, platform.toLowerCase(), platformId);

      if (result.status === 'failed') {
        return res.status(400).json(result);
      }
  
      if (!result.userId) {
        // Handle the case where userId is undefined
        console.error('User ID is undefined');
        return res.status(500).json({ status: 'error', message: 'Internal server error during user registration' });
      }
  
      // Set user details
      const userDetailsResult = await setUserDetails(result.userId, '');

      if (userDetailsResult.status === 'failed') {
        // Handle the case where setting user details fails
        return res.status(400).json(userDetailsResult);
      }

      const userDoc = await db.collection(userCollection).doc(result.userId).get();

      if (!userDoc.exists) {
        return res.status(404).json({ status: 'error', message: 'User not found' });
      }
    
      const userData = userDoc.data();

      if (!userData) {
        console.log('User data is undefined');
        return res.status(500).json('Internal server error');
      }
      const credentialsDoc = await db.collection(credentialsCollection).doc(result.userId).get();

      if (!credentialsDoc.exists) {
        return res.status(404).json({ status: 'error', message: 'credentialsDoc not found' });
      }
    
      const platformData = credentialsDoc.data();

      if (!platformData) {
        console.log('credentialsDoc is undefined');
        return res.status(500).json('Internal server error');
      }

      return res.status(200).json({ status: 'success', message: 'Login successful', data: { userId: userDoc.id, ...userData, platform: platformData.platform, loginTime: loginTime} });
    }
    
  } catch (error) {
    console.error('Error during login:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error during login' });
  }
});

// Reset Password
app.post('/user/reset-password', async (req, res) => {
  try {
    const { email, resetToken, newPassword, confirmNewPassword } = req.body;

    // Check if email, resetToken, newPassword, and confirmNewPassword are provided
    if (!email || !resetToken || !newPassword || !confirmNewPassword) {
      return res.status(400).json({ status: 'error', message: 'Email, reset token, new password, and confirm new password are required' });
    }

    // Check if newPassword matches confirmNewPassword
    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ status: 'error', message: 'New password and confirm new password do not match' });
    }

    // Query the credentials collection to get the user's information
    const credentialsRef = db.collection(credentialsCollection).where('email', '==', email);
    const credentialsSnapshot = await credentialsRef.get();

    // Check if the user exists in the credentials collection
    if (credentialsSnapshot.empty) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Get user data
    const userData = credentialsSnapshot.docs[0].data();

    // Check if userData and resetToken exist
    if (!userData || !userData.resetToken) {
      return res.status(400).json({ status: 'error', message: 'Invalid request' });
    }

    // Check if the reset token matches the token in the credentials document
    const savedResetToken = userData.resetToken;

    if (resetToken !== savedResetToken) {
      return res.status(400).json({ status: 'error', message: 'Invalid reset token' });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the password and reset token in the credentials collection for the user
    await credentialsSnapshot.docs[0].ref.update({ hashedPassword: hashedPassword, resetToken: '' });

    return res.status(200).json({ status: 'success', message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error resetting password:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Change Player Name
app.put('/user/change-playername', async (req, res) => {
  try {
    const { userId, playerName } = req.body;

    if (!userId || !playerName) {
      return res.status(400).json({ status: 'error', message: 'Invalid request body' });
    }

    // Convert the new player name to lowercase for case-insensitive comparison
    const playerNameLower = playerName.toLowerCase();

    // Check if the new player name already exists in the monster collection
    const monsterQuery = db.collection(monsterCollection).where('name', '==', playerNameLower);
    const monsterSnapshot = await monsterQuery.get();

    if (!monsterSnapshot.empty) {
      return res.status(400).json({ status: 'error', message: 'Player name already in use' });
    }

    // Check if the new player name already exists in the user collection
    const nameQuery = db.collection(userCollection).where('playerNameLower', '==', playerNameLower);
    const nameSnapshot = await nameQuery.get();

    if (!nameSnapshot.empty) {
      return res.status(400).json({ status: 'error', message: 'Player name already in use' });
    }

    const userRef = db.collection(userCollection).doc(userId);

    // Fetch the current user document
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Update the player name in the user document
    await userRef.update({
      playerName: playerName,
      playerNameLower: playerNameLower
    });

    // Return only the new player name
    return res.status(200).json({ status: 'success', message: 'Player name changed successfully', data: { playerName: playerName } });
  } catch (error) {
    console.error('Error changing player name:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Update pilot and spaceship first time after login
app.put('/user/select-pilot-spaceship', async (req, res) => {
  try {
    const { userId, pilot, spaceship } = req.body;

    // Validate that userId is present
    if (!userId) {
      return res.status(400).json({ status: 'error', message: 'Incomplete request data' });
    }

    const userRef = db.collection(userCollection).doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Get current user data
    const userData: User = userDoc.data() as User; // Explicit cast to User interface

    if (!userData) {
      return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }

    // Update the specified attributes
    updateInventory(userData, pilot, spaceship);
    updateActiveAttributes(userData, pilot, spaceship);

    // Update the user document
    await userRef.update(userData as unknown as { [x: string]: unknown; });

    // Fetch and return the updated user data
    const updatedUserDoc = await userRef.get();
    const updatedUserData = updatedUserDoc.data();

    if (!updatedUserData) {
      console.log('Updated User Data is undefined');
      return res.status(500).json('Internal server error');
    }
    
    const data = { inventory: updatedUserData.inventory, pilotActive: updatedUserData.pilotActive, spaceshipActive: updatedUserData.spaceshipActive };

    return res.status(200).json({ status: 'success', message: 'User attributes updated successfully', data });
  } catch (error) {
    console.error('Error updating user attributes:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Get user by firestore ID
app.get('/user/find-by-id/:userId', async (req, res) => {
  try {
    const userId = req.params['userId'];

    if (!userId) {
      return res.status(400).json({ status: 'error', message: 'userId is not defined' });
    }

    const userDoc = await db.collection(userCollection).doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const credentialsDoc = await db.collection(credentialsCollection).doc(userId).get();

    // if (!credentialsDoc.exists) {
    //   return res.status(404).json({ status: 'error', message: 'User not found' });
    // }
    
    const userData = userDoc.data();
    const credentialsData = credentialsDoc.data();

    if (!userData) {
      console.log('User data is undefined');
      return res.status(500).json('Internal server error');
    }

    const currentTime = new Date();
    currentTime.setHours(currentTime.getHours() + 7);

    // Format the login time
    const month = (currentTime.getMonth() + 1).toString().padStart(2, '0');
    const date = currentTime.getDate().toString().padStart(2, '0');
    const year = currentTime.getFullYear();
    const hours = currentTime.getHours().toString().padStart(2, '0');
    const minutes = currentTime.getMinutes().toString().padStart(2, '0');
    const seconds = currentTime.getSeconds().toString().padStart(2, '0');
    const milliseconds = currentTime.getMilliseconds().toString().padStart(3, '0');
    const loginTime = `${month}/${date}/${year} ${hours}:${minutes}:${seconds}.${milliseconds}`;

    if (userData.dailyLogin) {
      const currentDateTime = new Date().toLocaleString('en-US', {timeZone: 'Asia/Bangkok'}); // Adjusted for Thai timezone
      const currentDate = new Date(currentDateTime);
      const currentHour = currentDate.getHours();
      const timeUntilNextLogin = calculateTimeUntilNextLogin(new Date(userData.dailyLogin.lastLogin), currentHour);
      userData.dailyLogin.timeUntilNextLogin = timeUntilNextLogin
    }

    const result = {
      data: {
        userId: userDoc.id,
        ...userData,
        platform: credentialsData?.platform || {} ,
        loginTime: loginTime
      },
    };

    // Check if request, block, and friend arrays are all empty
    if (userData.playerList.request.length === 0 && userData.playerList.block.length === 0 && userData.playerList.friend.length === 0) {
      return res.status(200).json({ status: 'success', message: 'User retrieved successfully', data: result.data });
    } else {
      console.log('At least one array is not empty');
      // Get the friend list from user data
      const playerList = userData.playerList || [];

      // Create the desired structure for playerList
      const formattedPlayerList = [
        { type: 'friend', users: playerList.friend || [] },
        { type: 'request', users: playerList.request || [] },
        { type: 'block', users: playerList.block || [] },
      ];

      // Get user details for each user ID in playerList
      const userDetails = await getUserDetailsByIds(formattedPlayerList);

      const formattedPlayerListResponse: { [key: string]: unknown } = {};

      formattedPlayerList.forEach((list) => {
        formattedPlayerListResponse[list.type] = userDetails
          .filter((user) => list.users.includes(user.userId))
          .map((user) => ({
            userId: user.userId,
            playerName: user.playerName,
            pilotActive: user.pilotActive,
          }));
      });
      return res.status(200).json({
        status: 'success',
        message: 'User retrieved successfully',
        data: { ...result.data, playerList: formattedPlayerListResponse },
      });
    }

  } catch (error) {
    console.error('Error fetching user data:', error);
    return res.status(500).json('Internal server error');
  }
});

// Update Pilot Active
app.put('/user/update-pilot-active', async (req, res) => {
  try {
    const { userId, pilotActive } = req.body;

    if (!userId || !pilotActive) {
      return res.status(400).json({ status: 'error', message: 'Invalid request body' });
    }

    const userRef = db.collection(userCollection).doc(userId);

    // Check if the user exists
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Update the pilotActive field in the user document
    await userRef.update({
      pilotActive: pilotActive,
    });

    // Return only the new pilotActive value
    return res.status(200).json({ status: 'success', message: 'Pilot active updated successfully', data: { pilotActive: pilotActive } });
  } catch (error) {
    console.error('Error updating pilot active:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Update Spaceship Active
app.put('/user/update-spaceship-active', async (req, res) => {
  try {
    const { userId, spaceshipActive } = req.body;

    if (!userId || !spaceshipActive) {
      return res.status(400).json({ status: 'error', message: 'Invalid request body' });
    }

    const userRef = db.collection(userCollection).doc(userId);

    // Check if the user exists
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Update the spaceshipActive field in the user document
    await userRef.update({
      spaceshipActive: spaceshipActive,
    });

    // Return only the new spaceshipActive value
    return res.status(200).json({ status: 'success', message: 'Spaceship active updated successfully', data: { spaceshipActive: spaceshipActive } });
  } catch (error) {
    console.error('Error updating spaceship active:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Generating a match code
app.post('/match/generate-code', async (req, res) => {
  try {
    let matchCode;
    let codeSnapshot;
    const codeRef = db.collection(matchesDataCollection);

    // Generate a unique match code
    do {
      matchCode = generateRandomString(10);
      codeSnapshot = await codeRef.where('matchCode', '==', matchCode).get();
    } while (!codeSnapshot.empty);

    // Return the generated match code
    return res.status(200).json({ status: 'success', matchCode });
  } catch (error) {
    console.error('Error generating match code:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Update playing information
app.put('/user/update-playing-information', async (req, res) => {
  try {
    const { userId, kills, deaths, playTime, currentPlayer, ranking, mode, matchType, matchCode } = req.body;
    
    // Check if kills, deaths, and playTime are numbers, and if currentPlayer is a number, ranking is a number, mode is a string, and matchCode is a string
    if (!userId || isNaN(kills) || isNaN(deaths) || isNaN(playTime) || isNaN(currentPlayer) || isNaN(ranking) || typeof mode !== 'string' || typeof matchCode !== 'string' || typeof matchType !== 'string') {
      // Return error response if any of the conditions are not met
      return res.status(400).json({
        status: 'error',
        message: 'Invalid request body. userId, kills, deaths, and playTime must be provided and have valid numeric values. currentPlayer and ranking must be numeric, mode, matchType, and matchCode must be strings.',
      });
    }

    let exp = 0; // New variable for exp
    const currency = { coin: 0 }; // New variable for currency

    // Check if the matchCode is duplicate for the user
    const existingMatch = await db.collection(matchesDataCollection)
      .where('userId', '==', userId)
      .where('matchCode', '==', matchCode)
      .get();

    if (!existingMatch.empty) {
      return res.status(400).json({
        status: 'error',
        message: 'Duplicate matchCode. This match has already been recorded for the user.',
      });
    }

    const playingData = {
      userId: userId,
      kills: kills,
      deaths: deaths,
      ranking: ranking,
      currentPlayer: currentPlayer,
      playTime: playTime,
      mode: mode,
      matchType: matchType,
      matchCode: matchCode,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Add the playing data to the 'playingData' collection
    await db.collection(matchesDataCollection).add(playingData);

    if (mode === 'DeathMatch') {
      // Call the deathMatchCalulator function to get exp and coins
      const calculatorResult = deathMatchCalulator(kills, deaths, currentPlayer, ranking, matchType);

      // Update exp and currency
      exp = calculatorResult.exp;
      currency.coin = calculatorResult.coin;
    }

    const userRef = db.collection(userCollection).doc(userId);

    // Fetch the current user document
    const userDoc = await userRef.get();
    const userData = userDoc.data();

    if (!userData) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Check if playingInformation exists and is an object
    if (!userData.playingInformation || typeof userData.playingInformation !== 'object') {
      userData.playingInformation = {}; // Initialize playingInformation as an object
    }

    // Find the Death Match information or initialize it
    const deathMatchStats = userData.playingInformation.deathMatch;

    // Increment the matches count by 1
    const matches = (deathMatchStats?.matches || 0) + 1;

    // Update the Death Match information
    const updatedDeathMatchStats = {
      matches: matches,
      win: ranking === 1 ? (deathMatchStats?.win || 0) + 1 : (deathMatchStats?.win || 0),
      kills: kills + (deathMatchStats?.kills || 0),
      deaths: deaths + (deathMatchStats?.deaths || 0),
      playTime: playTime + (deathMatchStats?.playTime || 0),
    };

    // Update the user document with the new Death Match information
    userData.playingInformation.deathMatch = updatedDeathMatchStats;

    // Update user document with exp, currency, and playingInformation
    await userRef.update({
      exp: userData.exp + exp,
      currency: { coin: userData.currency.coin + currency.coin , diamond: userData.currency.diamond},
      playingInformation: userData.playingInformation,
    });

    // Fetch and return the updated user data
    const updatedUserDoc = await userRef.get();
    const updatedUserData = updatedUserDoc.data();

    // Check if updatedUserData is defined before accessing properties
    if (!updatedUserData) {
      return res.status(500).json({ status: 'error', message: 'Internal server error - updated user data is undefined' });
    }

    // Return the specific format for playingInformation
    const responseData = {
      playingInformation: updatedUserData.playingInformation,
      exp: updatedUserData.exp || exp,
      currency: updatedUserData.currency || currency,
    };

    return res.status(200).json({ status: 'success', message: 'Death Match information updated successfully', data: responseData });
  } catch (error) {
    console.error('Error updating Death Match information:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Search Player Name
app.get('/user/search-playername', async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || typeof query !== 'string' || query.length < 4) {
      return res.status(400).json({ status: 'error', message: 'Invalid or too short query parameter' });
    }

    // Convert the query to lowercase for case-insensitive search
    const lowercaseQuery = query.toLowerCase();

    // Perform a Firestore query to find user(s) with a similar player name
    const userRef = db.collection(userCollection);
    const querySnapshot = await userRef.get();

    // Extract relevant data from the query results
    const results = querySnapshot.docs
      .filter(doc => {
        const playerName = doc.data().playerName;
        if (!playerName) {
          console.log(`Player name is undefined for document with ID: ${doc.id}`);
          return false;
        }
        return playerName.toLowerCase().includes(lowercaseQuery);
      })
      .map(doc => ({
        userId: doc.id,
        playerName: doc.data().playerName,
        pilotActive: doc.data().pilotActive
      }));

    return res.status(200).json({ status: 'success', message: 'Player name search successful', data: results });
  } catch (error) {
    console.error('Error searching player name:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Get player list API
app.get('/user/get-player-list', async (req, res) => {
  try {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : '';

    if (!userId) {
      return res.status(400).json({ status: 'error', message: 'Invalid query parameter' });
    }

    const userRef = db.collection(userCollection).doc(userId);

    // Retrieve user data
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const userData = userDoc.data();

    // Check if userData is defined before accessing properties
    if (!userData) {
      return res.status(500).json({ status: 'error', message: 'Internal server error - User data is undefined' });
    }

    // Get the friend list from user data
    const playerList = userData.playerList || [];

    // Create the desired structure for playerList
    const formattedPlayerList = [
      { type: 'friend', users: playerList.friend || [] },
      { type: 'request', users: playerList.request || [] },
      { type: 'block', users: playerList.block || [] },
    ];

    // Get user details for each user ID in playerList
    const userDetails = await getUserDetailsByIds(formattedPlayerList);

    const formattedPlayerListResponse: { [key: string]: unknown } = {};

    formattedPlayerList.forEach((list) => {
      formattedPlayerListResponse[list.type] = userDetails
        .filter((user) => list.users.includes(user.userId))
        .map((user) => ({
          userId: user.userId,
          playerName: user.playerName,
          pilotActive: user.pilotActive,
        }));
    });

    return res.status(200).json({
      status: 'success',
      message: 'Player list retrieved successfully',
      data: { playerList: formattedPlayerListResponse },
    });
  } catch (error) {
    console.error('Error getting player list:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error', error: (error as Error).message });  }
});

// Send Friend Request
app.post('/user/send-friend-request', async (req, res) => {
  try {
    const { userId, friendId } = req.body;

    // Validate request body
    if (!userId || !friendId) {
      return res.status(400).json({ status: 'error', message: 'Invalid request body' });
    }

    const myFriendList = db.collection(userCollection).doc(userId);

    // Retrieve user data
    const myDoc = await myFriendList.get();

    if (!myDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const myData = myDoc.data();

    // Ensure userData is defined before accessing properties
    if (!myData) {
      return res.status(500).json({ status: 'error', message: 'Internal server error - user data is undefined' });
    }

    // Check if friendId is in the block list
    if (myData.playerList?.block && myData.playerList.block.includes(friendId)) {
      return res.status(400).json({ status: 'error', message: 'Friend request cannot be sent to this user as they have been blocked' });
    }

    const userRef = db.collection(userCollection).doc(friendId);

    // Retrieve user data
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const userData = userDoc.data();

    // Ensure userData is defined before accessing properties
    if (!userData) {
      return res.status(500).json({ status: 'error', message: 'Internal server error - user data is undefined' });
    }

    // Check if friendId is already in the request list
    if (userData.playerList?.request && userData.playerList.request.includes(userId)) {
      return res.status(400).json({ status: 'error', message: 'Friend request has already been sent to this user' });
    }
    
    // Check if friendId is in the friend list
    if (userData.playerList?.friend && userData.playerList.friend.includes(userId)) {
      return res.status(400).json({ status: 'error', message: 'Friend request cannot be sent to this user as they are already friends' });
    }

    // Check if friendId is in the block list
    if (userData.playerList?.block && userData.playerList.block.includes(userId)) {
      return res.status(400).json({ status: 'error', message: 'Friend request cannot be sent to this user as they have been blocked' });
    }

    // Add the friend to the user's request list
    const updatedRequestList = [...(userData.playerList?.request || []), userId];

    // Update the user document with the new request list
    await userRef.update({
      'playerList.request': updatedRequestList,
    });

    return res.status(200).json({ status: 'success', message: 'Friend request sent successfully' });
  } catch (error) {
    console.error('Error sending friend request:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Accept Friend Request
app.post('/user/accept-friend-request', async (req, res) => {
  try {
    const { userId, friendId } = req.body;

    if (!userId || !friendId) {
      return res.status(400).json({ status: 'error', message: 'Invalid request body' });
    }

    const userRef = db.collection(userCollection).doc(userId);
    const friendRef = db.collection(userCollection).doc(friendId);

    // Retrieve user data
    const [userDoc, friendDoc] = await Promise.all([userRef.get(), friendRef.get()]);

    if (!userDoc.exists || !friendDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User or friend not found' });
    }

    // Ensure userData and friendData are defined before accessing properties
    const userData = userDoc.data();
    const friendData = friendDoc.data();

    if (!userData || !friendData) {
      return res.status(500).json({ status: 'error', message: 'Internal server error - user or friend data is undefined' });
    }

    // Check if friendId is in the request list before updating
    if (userData.playerList?.request.includes(friendId)) {
      // Remove the friend from the request list for both users
      const updatedRequestList = userData.playerList.request.filter((request: string) => request !== friendId);
      const updatedRequestListForFriend = friendData.playerList.request.filter((request: string) => request !== userId);

      // Add the friend to the friend list for both users if they are not already friends
      const updatedFriendList = [...(userData.playerList.friend || []), friendId];
      const updatedFriendListForFriend = [...(friendData.playerList.friend || []), userId];

      // Check if the friendId is already in the user's friend list
      if (userData.playerList?.friend.includes(friendId)) {
        // Return success without updating friend list
        return res.status(200).json({
          status: 'success',
          message: 'Friend request accepted successfully. User is already your friend.',
        });
      }

      // Update the user document with the new request and friend lists
      await Promise.all([
        userRef.update({
          'playerList.request': updatedRequestList,
          'playerList.friend': updatedFriendList,
        }),
        friendRef.update({
          'playerList.request': updatedRequestListForFriend,
          'playerList.friend': updatedFriendListForFriend,
        }),
      ]);

      // Fetch the updated user data
      const updatedUserDoc = await userRef.get();
      const updatedUserData = updatedUserDoc.data();

      if (!updatedUserData) {
        return res.status(500).json({
          status: 'error',
          message: 'Internal server error - updated user data is undefined',
        });
      }

      // Continue with the rest of the logic using updatedUserData
      const updatedPlayerList = updatedUserData.playerList || [];

      // Create the desired structure for playerList
      const formattedPlayerList = [
        { type: 'friend', users: updatedPlayerList.friend || [] },
        { type: 'request', users: updatedPlayerList.request || [] },
        { type: 'block', users: updatedPlayerList.block || [] },
      ];

      // Get user details for each user ID in playerList
      const userDetails = await getUserDetailsByIds(formattedPlayerList);

      // Initialize formattedPlayerListResponse
      const formattedPlayerListResponse: { [key: string]: unknown } = {};

      formattedPlayerList.forEach((list) => {
        formattedPlayerListResponse[list.type] = userDetails
          .filter((user) => list.users.includes(user.userId))
          .map((user) => ({
            userId: user.userId,
            playerName: user.playerName,
            pilotActive: user.pilotActive,
          }));
      });

      return res.status(200).json({
        status: 'success',
        message: 'Friend request accepted successfully',
        data: { playerList: formattedPlayerListResponse },
      });
    } else {
      // Handle the case where the friendId is not in the request list
      return res.status(400).json({ status: 'error', message: 'Friend request not found in the request list' });
    }
  } catch (error) {
    console.error('Error accepting friend request:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Remove Friend Request
app.post('/user/remove-friend-request', async (req, res) => {
  try {
    const { userId, friendId } = req.body;

    // Validate request body
    if (!userId || !friendId) {
      return res.status(400).json({ status: 'error', message: 'Invalid request body' });
    }

    // Get references to user and friend documents
    const userRef = db.collection(userCollection).doc(userId);
    const friendRef = db.collection(userCollection).doc(friendId);

    // Retrieve user and friend data
    const [userDoc, friendDoc] = await Promise.all([userRef.get(), friendRef.get()]);

    if (!userDoc.exists || !friendDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User or friend not found' });
    }

    // Ensure userData and friendData are defined before accessing properties
    const userData = userDoc.data();
    const friendData = friendDoc.data();

    if (!userData || !friendData) {
      return res.status(500).json({ status: 'error', message: 'Internal server error - user or friend data is undefined' });
    }

    // Remove friendId from user's request list
    const updatedRequestList = userData.playerList?.request.filter((request: string) => request !== friendId);

    // Update user document with the new request list
    await userRef.update({
      'playerList.request': updatedRequestList,
    });

    // Fetch the updated user data
    const updatedUserDoc = await userRef.get();
    const updatedUserData = updatedUserDoc.data();

    if (!updatedUserData) {
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error - updated user data is undefined',
      });
    }

    // Continue with the rest of the logic using updatedUserData
    const updatedPlayerList = updatedUserData.playerList || [];

    // Create the desired structure for playerList
    const formattedPlayerList = [
      { type: 'friend', users: updatedPlayerList.friend || [] },
      { type: 'request', users: updatedPlayerList.request || [] },
      { type: 'block', users: updatedPlayerList.block || [] },
    ];

    // Get user details for each user ID in playerList
    const userDetails = await getUserDetailsByIds(formattedPlayerList);

    // Initialize formattedPlayerListResponse
    const formattedPlayerListResponse: { [key: string]: unknown } = {};

    formattedPlayerList.forEach((list) => {
      formattedPlayerListResponse[list.type] = userDetails
        .filter((user) => list.users.includes(user.userId))
        .map((user) => ({
          userId: user.userId,
          playerName: user.playerName,
          pilotActive: user.pilotActive,
        }));
    });

    // Return success response
    return res.status(200).json({
      status: 'success',
      message: 'Friend request removed successfully',
      data: { playerList: formattedPlayerListResponse },
    });
  } catch (error) {
    console.error('Error removing friend request:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Remove Friend
app.post('/user/remove-friend', async (req, res) => {
  try {
    const { userId, friendId } = req.body;

    // Validate request body
    if (!userId || !friendId) {
      return res.status(400).json({ status: 'error', message: 'Invalid request body' });
    }

    const userRef = db.collection(userCollection).doc(userId);

    // Retrieve user data
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const userData = userDoc.data();

    // Ensure userData is defined before accessing properties
    if (!userData) {
      return res.status(500).json({ status: 'error', message: 'Internal server error - user data is undefined' });
    }

    // Check if friendId is in the friend list
    if (!(userData.playerList?.friend && userData.playerList.friend.includes(friendId))) {
      return res.status(400).json({ status: 'error', message: 'User is not your friend' });
    }

    // Remove the friend from the first user's friend list
    const updatedFriendList = userData.playerList.friend.filter((friend: string) => friend !== friendId);

    // Update the first user's document with the new friend list
    await userRef.update({
      'playerList.friend': updatedFriendList,
    });

    // Now, remove the first user from the friend list of the second user (if exists)
    const friendRef = db.collection(userCollection).doc(friendId);
    const friendDoc = await friendRef.get();

    if (friendDoc.exists) {
      const friendData = friendDoc.data();

      if (friendData?.playerList?.friend && friendData.playerList.friend.includes(userId)) {
        const updatedFriendListOther = friendData.playerList.friend.filter((friend: string) => friend !== userId);
        await friendRef.update({
          'playerList.friend': updatedFriendListOther,
        });
      }
    }

    // Fetch the updated user data
    const updatedUserDoc = await userRef.get();
    const updatedUserData = updatedUserDoc.data();

    if (!updatedUserData) {
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error - updated user data is undefined',
      });
    }

    // Continue with the rest of the logic using updatedUserData
    const updatedPlayerList = updatedUserData.playerList || [];

    // Create the desired structure for playerList
    const formattedPlayerList = [
      { type: 'friend', users: updatedPlayerList.friend || [] },
      { type: 'request', users: updatedPlayerList.request || [] },
      { type: 'block', users: updatedPlayerList.block || [] },
    ];

    // Get user details for each user ID in playerList
    const userDetails = await getUserDetailsByIds(formattedPlayerList);

    // Initialize formattedPlayerListResponse
    const formattedPlayerListResponse: { [key: string]: unknown } = {};

    formattedPlayerList.forEach((list) => {
      formattedPlayerListResponse[list.type] = userDetails
        .filter((user) => list.users.includes(user.userId))
        .map((user) => ({
          userId: user.userId,
          playerName: user.playerName,
          pilotActive: user.pilotActive,
        }));
    });

    // Return success response
    return res.status(200).json({
      status: 'success',
      message: 'Friend removed successfully',
      data: { playerList: formattedPlayerListResponse },
    });
  } catch (error) {
    console.error('Error removing friend:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Block Player
app.post('/user/block-player', async (req, res) => {
  try {
    const { userId, playerToBlockId } = req.body;

    if (!userId || !playerToBlockId) {
      return res.status(400).json({ status: 'error', message: 'Invalid request body' });
    }

    const userRef = db.collection(userCollection).doc(userId);
    const playerToBlockRef = db.collection(userCollection).doc(playerToBlockId);

    // Retrieve user and player to block data
    const [userDoc, playerToBlockDoc] = await Promise.all([userRef.get(), playerToBlockRef.get()]);

    if (!userDoc.exists || !playerToBlockDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User or player to block not found' });
    }

    const userData = userDoc.data();
    const playerToBlockData = playerToBlockDoc.data();

    if (!userData || !playerToBlockData) {
      return res.status(500).json({ status: 'error', message: 'Internal server error - user or player to block data is undefined' });
    }

    // Update the block list in the user document
    await userRef.update({
      'playerList.block': admin.firestore.FieldValue.arrayUnion(playerToBlockId),
      'playerList.friend': admin.firestore.FieldValue.arrayRemove(playerToBlockId),
      'playerList.request': admin.firestore.FieldValue.arrayRemove(playerToBlockId),
    });

    // Additionally, if the user to block has the blocking user in their friend list,
    // you may want to remove the blocking user from their friend list as well.
    await playerToBlockRef.update({
      'playerList.friend': admin.firestore.FieldValue.arrayRemove(userId),
    });

    // Fetch the updated user data
    const updatedUserDoc = await userRef.get();
    const updatedUserData = updatedUserDoc.data();

    if (!updatedUserData) {
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error - updated user data is undefined',
      });
    }

    // Continue with the rest of the logic using updatedUserData
    const updatedPlayerList = updatedUserData.playerList || [];

    // Create the desired structure for playerList
    const formattedPlayerList = [
      { type: 'friend', users: updatedPlayerList.friend || [] },
      { type: 'request', users: updatedPlayerList.request || [] },
      { type: 'block', users: updatedPlayerList.block || [] },
    ];

    // Use getUserDetailsByIds to retrieve updated user details
    const userDetails = await getUserDetailsByIds(formattedPlayerList);

    // Create the desired structure for playerList
    const formattedPlayerListResponse = {
      friend: userDetails.filter((user) => updatedPlayerList.friend.includes(user.userId)),
      request: userDetails.filter((user) => updatedPlayerList.request.includes(user.userId)),
      block: userDetails.filter((user) => updatedPlayerList.block.includes(user.userId)),
    };

    return res.status(200).json({
      status: 'success',
      message: 'Player blocked successfully',
      data: { playerList: formattedPlayerListResponse },
    });
  } catch (error) {
    console.error('Error blocking player:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Unblock Player
app.post('/user/unblock-player', async (req, res) => {
  try {
    const { userId, unblockPlayerId } = req.body;

    const userRef = db.collection(userCollection).doc(userId);

    // Retrieve user data
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const userData = userDoc.data();

    // Ensure userData is defined before accessing properties
    if (!userData) {
      return res.status(500).json({ status: 'error', message: 'Internal server error - user data is undefined' });
    }

    // Check if unblockPlayerId is in the block list
    if (!(userData.playerList?.block && userData.playerList.block.includes(unblockPlayerId))) {
      return res.status(400).json({ status: 'error', message: 'User is not blocked' });
    }

    // Remove the user from the block list
    const updatedBlockList = userData.playerList.block.filter((blockedUser: string) => blockedUser !== unblockPlayerId);

    // Update the user document with the new block list
    await db.collection(userCollection).doc(userId).update({
      'playerList.block': updatedBlockList,
    });

    // Fetch the updated user data
    const updatedUserDoc = await userRef.get();
    const updatedUserData = updatedUserDoc.data();
 
    if (!updatedUserData) {
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error - updated user data is undefined',
      });
    }
 
    // Continue with the rest of the logic using updatedUserData
    const updatedPlayerList = updatedUserData.playerList || [];
 
    // Create the desired structure for playerList
    const formattedPlayerList = [
      { type: 'friend', users: updatedPlayerList.friend || [] },
      { type: 'request', users: updatedPlayerList.request || [] },
      { type: 'block', users: updatedPlayerList.block || [] },
    ];
 
    // Use getUserDetailsByIds to retrieve updated user details
    const userDetails = await getUserDetailsByIds(formattedPlayerList);
 
    // Create the desired structure for playerList
    const formattedPlayerListResponse = {
      friend: userDetails.filter((user) => updatedPlayerList.friend.includes(user.userId)),
      request: userDetails.filter((user) => updatedPlayerList.request.includes(user.userId)),
      block: userDetails.filter((user) => updatedPlayerList.block.includes(user.userId)),
    };
 
    return res.status(200).json({
      status: 'success',
      message: 'Player unblocked successfully',
      data: { playerList: formattedPlayerListResponse },
    });
  } catch (error) {
    console.error('Error unblocking user:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Buying an item
app.post('/user/buy-item', async (req, res) => {
  try {
    const { userId, itemId, paymentMethod } = req.body;

    if (!userId || !itemId || !paymentMethod) {
      return res.status(400).json({ status: 'error', message: 'Incomplete request data' });
    }

    if (paymentMethod !== 'coin' && paymentMethod !== 'diamond') {
      return res.status(400).json({ status: 'error', message: 'Payment method not supported' }); 
    }

    // Retrieve user data from the database
    const userDoc = await db.collection(userCollection).doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const userData = userDoc.data();

    // Retrieve item data from the database using where clause on itemId
    const itemQuery = await itemCollection.where('itemId', '==', itemId).get();

    if (itemQuery.empty) {
      return res.status(404).json({ status: 'error', message: 'Item not found' });
    }

    const itemDoc = itemQuery.docs[0];
    const itemData = itemDoc.data();

    // Check if the user already has the item in their inventory
    const isDuplicateItem = (itemType: string) =>
      userData?.inventory?.[itemType]?.some((item: string) => item === itemId);

    if ((itemData?.type === 'pilot' && isDuplicateItem('pilot')) || (itemData?.type === 'spaceship' && isDuplicateItem('spaceship'))) {
      return res.status(400).json({ status: 'error', message: 'User already has this item' });
    }

    // Check if the user has enough coins or diamonds to buy the item
    if (paymentMethod === 'coin' && userData?.currency.coin < itemData?.priceCoin) {
      return res.status(400).json({ status: 'error', message: 'Insufficient coins' });
    } else if (paymentMethod === 'diamond' && userData?.currency.diamond < itemData?.priceDiamond) {
      return res.status(400).json({ status: 'error', message: 'Insufficient diamonds' });
    }

    // Deduct the payment from the user's currency
    const currency = {
      coin: paymentMethod === 'coin' ? userData?.currency.coin - itemData?.priceCoin : userData?.currency.coin,
      diamond: paymentMethod === 'diamond' ? userData?.currency.diamond - itemData?.priceDiamond : userData?.currency.diamond,
    };

    // Update the user's currency in the database
    await db.collection(userCollection).doc(userId).update({
      currency: currency,
    });

    // Add the item to the user's inventory
    const updateInventory = async (itemType: string, itemId: string) => {
      // Modify this logic based on your actual data structure
      const updatedInventory = userData?.inventory?.[itemType] || [];

      // Check if the item with itemId already exists in the inventory
      const isDuplicateItem = updatedInventory.includes(itemId);

      if (!isDuplicateItem) {
        // Push the new itemId
        updatedInventory.push(itemId);

        // Update the user's inventory in the database
        await db.collection(userCollection).doc(userId).update({
          ['inventory.' + itemType]: updatedInventory,
        });

        return true; // Indicate that the item was added successfully
      } else {
        return false; // Indicate that the item is a duplicate
      }
    };

    // Add item to user's inventory based on its type
    const addedSuccessfully = await updateInventory(itemData.type, itemId);

    if (!addedSuccessfully) {
      return res.status(400).json({ status: 'error', message: 'User already has this item' });
    }

    return res.status(200).json({ status: 'success', message: 'Item purchased successfully', data: { currency , items: itemId} });
  } catch (error) {
    console.error('Error buying item:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Buy coins with diamonds
app.post('/user/buy-coins', async (req, res) => {
  try {
    const { userId, itemId } = req.body;

    // Check if userId and coinsToBuy are provided
    if (!userId || !itemId) {
      return res.status(400).json({ status: 'error', message: 'Invalid request. Please provide userId and a valid number of coins to buy' });
    }

    // Fetch user data
    const userRef = db.collection(userCollection).doc(userId);
    const userDoc = await userRef.get();
    const userData = userDoc.data();

    // Check if user exists
    if (!userData) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Retrieve item data from the database using where clause on itemId
    const itemQuery = await itemCollection.where('itemId', '==', itemId).get();

    if (itemQuery.empty) {
      return res.status(404).json({ status: 'error', message: 'Item not found' });
    }

    const itemDoc = itemQuery.docs[0];
    const itemData = itemDoc.data();

    // Check if the user has enough diamonds
    if (userData.currency.diamond < itemData.priceDiamond) {
      return res.status(400).json({ status: 'error', message: 'Insufficient diamonds to buy coins' });
    }

    // Update user data: deduct diamonds and add coins
    await userRef.update({
      'currency.diamond': userData.currency.diamond - itemData.priceDiamond,
      'currency.coin': userData.currency.coin + itemData.priceCoin
    });

    // Return updated user data
    const updatedUserDoc = await userRef.get();
    const updatedUserData = updatedUserDoc.data();

    return res.status(200).json({ status: 'success', message: 'coins bought successfully', data: updatedUserData?.currency });
  } catch (error) {
    console.error('Error buying coins:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Daily login
app.post('/user/daily-login', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ status: 'error', message: 'userId is not defined' });
    }
    
    const result = await DailyLogin(userId);

    return res.status(200).json({ status: 'success', message: result.message, data: result.data });
  } catch (error) {
    console.error('Error handling daily login:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Get time of daily login
app.get('/user/daily-login/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ status: 'error', message: 'userId is not defined' });
    }

    const userDoc = await db.collection(userCollection).doc(userId).get();
    const userData = userDoc.data();

    if (!userData) {
      console.log('User data is undefined');
      return res.status(500).json('Internal server error');
    }

    let timeUntilNextLogin = ''; // Declare timeUntilNextLogin variable

    if (userData.dailyLogin) {
      const currentDateTime = new Date().toLocaleString('en-US', {timeZone: 'Asia/Bangkok'}); // Adjusted for Thai timezone
      const currentDate = new Date(currentDateTime);
      const currentHour = currentDate.getHours();
      timeUntilNextLogin = calculateTimeUntilNextLogin(new Date(userData.dailyLogin.lastLogin), currentHour);
    } else {
      timeUntilNextLogin = '00:00:00'
      return res.status(200).json({ status: 'success', message: 'Time until next login retrieved successfully', data: { timeUntilNextLogin: timeUntilNextLogin } });
    }

    return res.status(200).json({ status: 'success', message: 'Time until next login retrieved successfully', data: { timeUntilNextLogin: timeUntilNextLogin } });
  } catch (error) {
    console.error('Error handling daily login:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}); 

// API endpoint to create the dailyLogin collection and initialize data
app.post('/create-daily-login', async (req, res) => {
  try {
    // Check if the dailyLogin collection already exists
    const collections = await db.listCollections();
    const dailyLoginCollection = collections.find(col => col.id === 'dailyLogin');

    if (dailyLoginCollection) {
      return res.status(400).json({ status: 'error', message: 'Collection already exists' });
    }

    // Create the dailyLogin collection
    await db.collection('dailyLogin').doc().set({
      maxDay: 7,
      items: [
        { day: 1, rewards: { type: 'coin', reward: '50' } },
        { day: 2, rewards: { type: 'coin', reward: '100' } },
        { day: 3, rewards: { type: 'diamond', reward: '10' } },
        { day: 4, rewards: { type: 'pilot', reward: 'CHA018' } },
        { day: 5, rewards: { type: 'coin', reward: '100' } },
        { day: 6, rewards: { type: 'diamond', reward: '50' } },
        { day: 7, rewards: { type: 'spaceship', reward: 'SHIP016' } },
        // Add more days as needed
      ]
    });

    return res.status(200).json({ status: 'success', message: 'DailyLogin collection created successfully' });
  } catch (error) {
    console.error('Error creating dailyLogin collection:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// API endpoint to get daily rewards by ID
app.get('/api/daily/:id', async (req, res) => {
  try {
    const dailyId = req.params.id;

    // Retrieve daily rewards data from Firestore based on daily ID
    const dailyRewardsDoc = await admin.firestore().collection('dailyLogin').doc(dailyId).get();

    // Check if the document exists
    if (!dailyRewardsDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'Daily rewards not found' });
    }

    // Extract daily rewards data
    const dailyRewardsData = dailyRewardsDoc.data();

    return res.status(200).json({ status: 'success', data: dailyRewardsData });
  } catch (error) {
    console.error('Error retrieving daily rewards:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

//  Add achievement
app.put('/user/add-achievement', async (req, res) => {
  try {
    const userId = req.body['userId'];
    const achievementToAdd = req.body['achievement'];

    if (!userId || !achievementToAdd) {
      return res.status(400).json('userId or achievement is not defined');
    }

    const usersRef = db.collection('users');
    const query = usersRef.where('achievement', 'array-contains', achievementToAdd);

    const existingItemSnapshot = await query.get();

    if (!existingItemSnapshot.empty) {
      return res.status(400).json('Achievement already exists');
    }

    await db.collection(userCollection).doc(userId).update({
      achievement: admin.firestore.FieldValue.arrayUnion(achievementToAdd),
    });

    return res.status(201).json('Achievement updated');
  } catch (error) {
    console.error('Error updating achievement:', error);
    return res.status(500).json('Internal server error');
  }
});

// Delete user by ID
app.delete('/user/:userId', async (req, res) => {
  try {
    const userId = req.params['userId'];

    if (!userId) {
      return res.status(400).json({ status: 'error', message: 'userId is not defined' });
    }

    // Delete user from userCollection
    const userRef = db.collection(userCollection).doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Delete corresponding user from credentialsCollection
    const credentialsRef = db.collection(credentialsCollection).doc(userId);
    const credentialsDoc = await credentialsRef.get();

    await userRef.delete();

    if (credentialsDoc.exists) {
      await credentialsRef.delete();
    }
    
    // Delete user from Firebase Authentication using platformId if available
    const credentialsData = credentialsDoc.data();

    if (!credentialsData) {
      return res.status(200).json({ status: 'success', message: 'User deleted successfully' });
    }

    if (credentialsData.platformId && credentialsData.platformId.google) {
      await deleteUserFromAuthentication(credentialsData.platformId.google);
    }
  
    return res.status(200).json({ status: 'success', message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// -------------------------------------------------------- [ Function ] ----------------------------------------------------------

// Delete a user from authenticated
const deleteUserFromAuthentication = async (uid: string) => {
  try {
    await admin.auth().deleteUser(uid);
    console.log('User deleted from Authentication successfully');
  } catch (error) {
    console.error('Error deleting user from Authentication:', error);
    throw error;
  }
};

// DailyLogin
const DailyLogin = async (userId: string) => {
  const userRef = db.collection(userCollection).doc(userId);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    throw new Error('User not found');
  }

  const userData = userDoc.data();
  const currentDateTime = new Date().toLocaleString('en-US', {timeZone: 'Asia/Bangkok'}); // Adjusted for Thai timezone
  const currentDate = new Date(currentDateTime);
  const currentDay = currentDate.toISOString().split('T')[0];
  const currentHour = currentDate.getHours();

  // Fetch the dailyLogin document for the user
  const dailyLoginDoc = await db.collection('dailyLogin').doc('gKiVI0QxznK1ghC1I3rx').get();

  if (!dailyLoginDoc.exists) {
    throw new Error('Daily login data not found');
  }

  const dailyLoginData = dailyLoginDoc.data();
  const maxDay = dailyLoginData?.maxDay || '';

  // Initialize dailyLogin if not present
  if (!userData?.dailyLogin) {
    const timeUntilNextLogin = calculateTimeUntilNextLogin(currentDate, currentHour);
    const rewards = dailyLoginData?.items[0].rewards || [];

    const updateData =  await updateRewards(userId, rewards);
    // Update user's inventory and currency with rewards
    await userRef.update({
      'dailyLogin.lastLogin': currentDay,
      'dailyLogin.days': 1
    });
    return {
      message: 'Daily login successful',
      data: { timeUntilNextLogin: timeUntilNextLogin, days: 1, currency: updateData.currency , inventory: updateData.inventory }
    };
  }

  if (userData?.dailyLogin.days >= maxDay) {
    return {
      message : 'Daily Login Limit Reached'
    }
  }

  // Check if the user has already logged in today
  if (userData?.dailyLogin.lastLogin === currentDay) {
    const timeUntilNextLogin = calculateTimeUntilNextLogin(userData.dailyLogin.lastLogin, currentHour);
    return {
      message: 'User has already logged in today',
      data: { timeUntilNextLogin, days: userData.dailyLogin.days },
    };
  }

  // Check if 24 hours have passed since the last login or it's the first login
  if (isNextDay(currentDate, new Date(userData.dailyLogin.lastLogin), currentHour) || isLastLoginBeforeCurrentDate(new Date(userData.dailyLogin.lastLogin), currentDate)) {
    const consecutiveDays = userData.dailyLogin.days + 1 

    await userRef.update({
      'dailyLogin.lastLogin': currentDay,
      'dailyLogin.days': consecutiveDays
      // You can add any additional logic or rewards for daily login here
    });

    // Calculate the time until the next login
    const timeUntilNextLogin = calculateTimeUntilNextLogin(currentDate, currentHour);
    const rewards = dailyLoginData?.items[consecutiveDays - 1].rewards || [];
    // Update user's inventory and currency with rewards
    const updateData =  await updateRewards(userId, rewards);
    
    return {
      message: 'Daily login successful',
      data: { timeUntilNextLogin, days: consecutiveDays, currency: updateData.currency , inventory: updateData.inventory },
    };
  } else {
    const timeUntilNextLogin = calculateTimeUntilNextLogin(new Date(userData.dailyLogin.lastLogin), currentHour);
    return { message: 'User has already logged in today', data: { timeUntilNextLogin, days: userData.dailyLogin.days } };
  }
};

// Helper function to calculate if next login is due
const isNextDay = (currentDate: Date, lastLoginDate: Date, currentHour: number) => {
  // Check if it's a new day and the current hour is past 7 AM
  return currentDate.getDate() !== lastLoginDate.getDate() && currentHour >= 7;
};

const isLastLoginBeforeCurrentDate = (lastLoginDate: Date, currentDate: Date): boolean => {
  // Convert both dates to timestamps
  const lastLoginTimestamp: number = lastLoginDate.getTime();
  const currentTimestamp: number = currentDate.getTime();
  
  // Check if the last login date is before the current date
  return lastLoginTimestamp < currentTimestamp;
};

// Helper function to calculate the time until the next login
const calculateTimeUntilNextLogin = (lastLogin: Date, currentHour: number) => {
  const nextLoginHour = 7; // Next login hour (7 AM)
  let timeDifference: number;

  const currentDateTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' });
  const currentDateTimeObject = new Date(currentDateTime);

  if (currentHour < nextLoginHour) {
    // If the current hour is before the next login hour, calculate time until next login for today
    const todayNextLogin = new Date(currentDateTimeObject);
    todayNextLogin.setHours(nextLoginHour, 0, 0, 0);
    timeDifference = todayNextLogin.getTime() - currentDateTimeObject.getTime();
  } else {
    // If the current hour has passed the next login hour, calculate time until next login for tomorrow
    const tomorrowNextLogin = new Date(lastLogin);
    tomorrowNextLogin.setDate(tomorrowNextLogin.getDate() + 1);
    tomorrowNextLogin.setHours(nextLoginHour, 0, 0, 0);
    timeDifference = tomorrowNextLogin.getTime() - currentDateTimeObject.getTime();
  }

  // If the time difference is negative, set it to 0
  if (timeDifference < 0) {
    timeDifference = 0;
  }

  // Convert the time difference to hours, minutes, and seconds
  const hours = Math.floor(timeDifference / (60 * 60 * 1000));
  const minutes = Math.floor((timeDifference % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((timeDifference % (60 * 1000)) / 1000);

  return `${formatTimeUnit(hours)}:${formatTimeUnit(minutes)}:${formatTimeUnit(seconds)}`;
};

// Helper function to format time units (hours, minutes, seconds) as two digits
const formatTimeUnit = (unit: number) => {
  return unit < 10 ? `0${unit}` : unit.toString();
};

const updateRewards = async (userId: string, reward: { type: string; reward: string }) => {
  const { type, reward: rewardValue } = reward;
  const userRef = db.collection(userCollection).doc(userId);

  try {
    // Fetch the user data
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    // Get the current user data
    const userData = userDoc.data();
    if (!userData) {
      throw new Error('User data is undefined');
    }

    switch (type) {
    case 'coin':
      // Update coin balance
      userData.currency.coin += parseInt(rewardValue, 10);
      break;
    case 'diamond':
      // Update diamond balance
      userData.currency.diamond += parseInt(rewardValue, 10);
      break;
    case 'spaceship':
      // Add spaceship to inventory
      if (!userData.inventory.spaceship) {
        userData.inventory.spaceship = [];
      }
      userData.inventory.spaceship.push(rewardValue);
      break;
    case 'pilot':
      // Add pilot to inventory
      if (!userData.inventory.pilot) {
        userData.inventory.pilot = [];
      }
      userData.inventory.pilot.push(rewardValue);
      break;
    default:
      // Invalid reward type
      console.error('Invalid reward type:', type);
      break;
    }

    // Update the user data in Firestore
    await userRef.update(userData);

    console.log('User data updated successfully');

    // Return the updated inventory and currency
    return { inventory: userData.inventory, currency: userData.currency };
  } catch (error) {
    console.error('Error updating user data:', error);
    throw new Error('Failed to update user data');
  }
};

// Define a function for creating a new user with credentials
const createUserWithPlatform = async (userId: string, email: string, platform: string, platformId: string) => {
  try {
    // Validation
    if (!platformId || !platform) {
      throw new Error('Platform or platformId is not defined');
    }
    
    if (platform.toLowerCase() !== 'apple' && !email) {
      throw new Error('Email is required for non-Apple platforms');
    }

    // Convert the email to lowercase for case-insensitive comparison and storage
    const lowercaseEmail = email.toLowerCase();

    // Check if the email exists within the platform object (email or google)
    const platformGoogleQuery = db.collection(credentialsCollection).where('platform.google', '==', lowercaseEmail);
    
    const [platformEmailSnapshot] = await Promise.all([
      // platformEmailQuery.get(),
      platformGoogleQuery.get()
    ]);

    if (!platformEmailSnapshot.empty) {
      // Duplicate user Email
      throw new Error('Email already in use');
    }

    // Update or add user credentials to the "credentials" collection
    const userRef = userId === 'register' ? 
      await db.collection(credentialsCollection).add({
        platform: {
          [platform]: lowercaseEmail
        },
        platformId: {
          [platform]: platformId
        }
      }) :
      db.collection(credentialsCollection).doc(userId);
    await userRef.set({
      platform: {
        [platform]: lowercaseEmail
      },
      platformId: {
        [platform]: platformId
      }
    }, { merge: true });

    // Return success response
    return {
      userId: userId === 'register' ? userRef.id : userId,
      status: 'success',
      message: 'User created successfully',
    };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    // Handle errors
    console.error('Error creating user:', error);

    return {
      status: 'failed',
      message: error.message || 'Internal server error during user creation',
    };
  }
};

// Define a function for creating a new user with credentials
const createUser = async (email: string | undefined, hashedPassword: string, token: string) => {
  try {
    if (email === undefined) {
      throw new Error('User Email is undefined');
    }

    // Convert the email to lowercase for case-insensitive comparison and storage
    const lowercaseEmail = email.toLowerCase();

    // Check if the email exists within the platform object (email or google)
    const platformEmailQuery = db.collection(credentialsCollection).where('platform.email', '==', lowercaseEmail);
    // const platformGoogleQuery = db.collection(credentialsCollection).where('platform.google', '==', lowercaseEmail);
    
    const [platformEmailSnapshot] = await Promise.all([
      platformEmailQuery.get(),
      // platformGoogleQuery.get()
    ]);

    if (!platformEmailSnapshot.empty) {
      // Duplicate user Email
      throw new Error('Email already in use');
    }

    // Save user credentials to the "credentials" collection
    const newCredentialsDoc = await db.collection(credentialsCollection).add({
      platform: {
        'email': lowercaseEmail
      },
      hashedPassword: hashedPassword,
      token: token
    });

    // Return user information
    return {
      userId: newCredentialsDoc.id,
      status: 'success',
      message: 'User created successfully',
    } as const;
  } catch (error) {
    console.error('Error creating user:', error);

    if (error instanceof Error && error.message === 'Email already in use') {
      return {
        status: 'failed',
        message: 'Email already in use',
      } as const;
    }

    return {
      status: 'failed',
      message: 'Internal server error during user creation',
    } as const;
  }
};

// Define a function for creating a new user with credentials
const createUserGuest = async (userId: string, email: string | undefined, hashedPassword: string, token: string) => {
  try {
    if (userId === undefined) {
      throw new Error('User UserId is undefined');
    }

    if (email === undefined) {
      throw new Error('User Email is undefined');
    }

    // Convert the email to lowercase for case-insensitive comparison and storage
    const lowercaseEmail = email.toLowerCase();

    // Check if the email exists within the platform object (email or google)
    const platformEmailQuery = db.collection(credentialsCollection).where('platform.email', '==', lowercaseEmail);
    
    const [platformEmailSnapshot] = await Promise.all([
      platformEmailQuery.get()
    ]);

    if (!platformEmailSnapshot.empty) {
      // Duplicate user Email
      throw new Error('Email already in use');
    }

    // Save user credentials to the "credentials" collection
    await db.collection(credentialsCollection).doc(userId).set({
      platform: {
        'email': lowercaseEmail
      },
      hashedPassword: hashedPassword,
      token: token
    },{ merge: true })

    // Return user information
    return {
      userId: userId,
      status: 'success',
      message: 'User created successfully',
    } as const;
  } catch (error) {
    console.error('Error creating user:', error);

    if (error instanceof Error && error.message === 'Email already in use') {
      return {
        status: 'failed',
        message: 'Email already in use',
      } as const;
    }

    return {
      status: 'failed',
      message: 'Internal server error during user creation',
    } as const;
  }
};

// Function to set user details
const setUserDetails = async (userId: string, email: string) => {
  try {

    // Set user data
    const newUser: User = {
      title: '',
      playerName: '',
      playerNameLower:'',
      exp: 0,
      pilotActive: '',
      spaceshipActive: '',
      inventory: {
        pilot: [],
        spaceship: [],
      },
      achievement: [],
      currency: {
        diamond: 0,
        coin: 0,
      },
      battlePass: 0,
      playerList: {
        friend: [],
        request: [],
        block: [],
      },
      playingInformation: {},
      email: email,
      isConfirmed: false
    };

    const userRef = userId === '' ? db.collection(userCollection).doc() : db.collection(userCollection).doc(userId);

    // Check if the user already exists using userRef
    const userDoc = await userRef.get();
    if (userDoc.exists) {
      return { status: 'failed', message: 'User data already set, no need to create again' };
    }

    await userRef.set(newUser);

    // Return additional data, such as userId
    return { status: 'success', message: 'User data set successfully', userId: userRef.id, userData: newUser };
  } catch (error) {
    console.error('Error setting user data:', error);
    throw error;
  }
};

type PlayerListEntry = {
  type: string;
  users: string[];
};

const getUserDetailsByIds = async (playerList: PlayerListEntry[]) => {
  try {
    const userDetails = [];

    for (const listEntry of playerList) {
      const userList = listEntry.users;

      if (Array.isArray(userList)) {
        for (const userId of userList) {
          const userRef = db.collection(userCollection).doc(userId);

          try {
            const userDoc = await userRef.get();

            if (userDoc.exists) {
              const userData = userDoc.data();

              if (userData) {
                const { playerName, pilotActive } = userData;

                if (playerName !== undefined) {
                  userDetails.push({ userId, playerName, pilotActive });
                } else {
                  console.error(`Player name is undefined for userId: ${userId}`);
                }
              } else {
                console.error(`User data is undefined for userId: ${userId}`);
              }
            } else {
              console.error(`User document not found for userId: ${userId}`);
            }
          } catch (error) {
            console.error(`Error fetching document for userId: ${userId}`, error);
          }
        }
      } else {
        console.error(`User list is not an array for type: ${listEntry.type}`);
      }
    }

    return userDetails;
  } catch (error) {
    console.error('Error getting user details by IDs:', error);
    throw error;
  }
};

// Helper function to update inventory attributes
const updateInventory = (userData: User, pilot: string | undefined, spaceship: string | undefined) => {
  // Ensure userData.inventory is initialized as an object
  if (!userData.inventory) userData.inventory = { pilot: [], spaceship: [] };

  if (pilot !== undefined) {
    // Check if the pilot is not already in the array before adding
    const pilotIndex = userData.inventory.pilot.indexOf(pilot);
    if (pilotIndex === -1) {
      userData.inventory.pilot.push(pilot);
    }
  }

  if (spaceship !== undefined) {
    // Check if the spaceship is not already in the array before adding
    const spaceshipIndex = userData.inventory.spaceship.indexOf(spaceship);
    if (spaceshipIndex === -1) {
      userData.inventory.spaceship.push(spaceship);
    }
  }
};

const updateActiveAttributes = (userData: User, pilot: string | undefined, spaceship: string | undefined) => {
  if (pilot !== undefined) {
    userData.pilotActive = pilot; // Assuming you want to set the first pilot as active
  }

  if (spaceship !== undefined) {
    userData.spaceshipActive = spaceship; // Assuming you want to set the first spaceship as active
  }
};

//Randeom string
const generateRandomString = (length: number): string => {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890';
  
  const randomArray = Array.from(
    { length: length },
    () => chars[Math.floor(Math.random() * chars.length)]
  );
  
  const randomString = randomArray.join('');
  return randomString;
};

// -------------------------------------------------------- [ Match Calulator ] ----------------------------------------------------------

// Function to calculate experience points and coins for Death Match
const deathMatchCalulator = (kills: number, deaths: number, currentPlayer: number, ranking: number, matchType: string) => {
  const maxPlayers = 8;
  let exp = 0;
  let coin = 0;
  let baseValue = 0;

  if (matchType === 'CustomRoom' || matchType === 'MatchMaking') {
    if (matchType === 'CustomRoom') {
      if (ranking === 1 ) {
        baseValue = 25;
      } else if (ranking === 2) {
        baseValue = 15;
      } else if (ranking === 3) {
        baseValue = 10;
      } else if (ranking >= 4 && ranking <= 8) {
        baseValue = 5;
      }
    } else if (matchType === 'MatchMaking') {
      if (ranking === 1) {
        baseValue = 50;
      } else if (ranking === 2) {
        baseValue = 40;
      } else if (ranking === 3) {
        baseValue = 35;
      } else if (ranking === 4) {
        baseValue = 30;
      } else if (ranking >= 5 && ranking <= 8) {
        baseValue = 25;
      }
    }

    // Calculate experience based on kills, deaths, currentPlayer, and maxPlayers
    exp = Math.floor((baseValue + (kills - deaths)) * currentPlayer / maxPlayers);

    // Calculate coin based on baseValue, currentPlayer, and maxPlayers
    coin = Math.floor(baseValue * currentPlayer / maxPlayers);
  }

  return { exp, coin };
};

// -------------------------------------------------------- [ ItemCollection ] ----------------------------------------------------------

// API endpoint to add an item to the itemCollection
app.post('/api/add-item', async (req, res) => {
  try {
    const { itemId, name, priceCoin, priceDiamond, type } = req.body;

    if (!itemId || !priceCoin || !priceDiamond || !type) {
      return res.status(400).json({ status: 'error', message: 'Incomplete item information' });
    }

    const newItem = {
      itemId,
      name,
      priceCoin,
      priceDiamond,
      type,
    };

    await itemCollection.doc().set(newItem);

    return res.status(201).json({ status: 'success', message: 'Item added successfully', data: newItem });
  } catch (error) {
    console.error('Error adding item:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Define API endpoint to get items by item type and order by price in coins
app.get('/items/:itemType', async (req, res) => {
  try {
    const itemType = req.params.itemType; // Extract item type from request parameters

    // Validate item type
    if (!itemType) {
      return res.status(400).json({ status: 'error', message: 'Item type is required' });
    }

    // Query database to retrieve items of the specified type, ordered by priceCoin
    const itemsSnapshot = await db.collection('items').where('type', '==', itemType).orderBy('priceCoin').get();

    // Extract data from snapshot
    const items: admin.firestore.DocumentData[] = [];
    itemsSnapshot.forEach((doc) => {
      items.push(doc.data());
    });

    // Return response with items
    return res.status(200).json({ status: 'success', data: items });
  } catch (error) {
    console.error('Error fetching items:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Define the route to get all items
app.get('/items', async (req, res) => {
  try {
    // Retrieve all items from your database
    const itemsSnapshot = await db.collection('items').get();

    // Extract the data from the snapshot and explicitly define the type
    const items: unknown[] = [];
    itemsSnapshot.forEach((doc) => {
      items.push({
        ...doc.data()
      });
    });

    // Return the items as a JSON response
    return res.status(200).json({ status: 'success', message: 'Items retrieved successfully', data: items });
  } catch (error) {
    console.error('Error fetching items:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Add all items
app.post('/api/addItems', async (req, res) => {
  try {
    const items = req.body;
    const batch = db.batch();

    items.forEach((item: { itemId: string; }) => {
      const itemRef = db.collection('items').doc();
      batch.set(itemRef, item);
    });

    await batch.commit();

    res.status(200).json({ message: 'Items added successfully' });
  } catch (error) {
    console.error('Error adding items:', error);
    res.status(500).json({ message: 'Failed to add items' });
  }
});

// Define the route to get all items
app.get('/monsters', async (req, res) => {
  try {
    // Retrieve all items from your database
    const itemsSnapshot = await db.collection('monsterData').get();

    // Extract the data from the snapshot and explicitly define the type
    const items: unknown[] = [];
    itemsSnapshot.forEach((doc) => {
      items.push({
        ...doc.data()
      });
    });

    // Return the items as a JSON response
    return res.status(200).json({ status: 'success', message: 'Items retrieved successfully', data: items });
  } catch (error) {
    console.error('Error fetching items:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Define the route to update an item by item ID
app.put('/items/:itemId', async (req, res) => {
  try {
    const itemId = req.params.itemId;

    // Validate the item ID (you can add your own validation logic here)
    if (!itemId) {
      return res.status(400).json({ status: 'error', message: 'Item ID is required' });
    }

    // Extract the updated item data from the request body
    const updatedItemData = req.body;

    // Update the item in your database (replace 'items' with your collection name)
    const itemRef = db.collection('items').where('itemId', '==', itemId);
    const snapshot = await itemRef.get();

    if (snapshot.empty) {
      return res.status(404).json({ status: 'error', message: 'Item not found' });
    }

    const itemDoc = snapshot.docs[0]; // Get the first document in the snapshot
    await itemDoc.ref.update(updatedItemData);

    // Return a success response
    return res.status(200).json({ status: 'success', message: 'Item updated successfully' });
  } catch (error) {
    console.error('Error updating item:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// -------------------------------------------------------- [ Purchases ] ----------------------------------------------------------

// API endpoint to handle purchase
app.post('/user/in-app-purchase', async (req, res) => {
  try {
    const { userId, store, productId, purchaseToken, signature, transactionId, payload } = req.body;

    if (!store || !productId) {
      return res.status(400).json({ status: 'error', message: 'Incomplete request data' });
    }

    const currency = { diamond: 0 }; // New variable for currency
    const userRef = db.collection(userCollection).doc(userId);

    // Fetch the current user document
    const userDoc = await userRef.get();
    const userData = userDoc.data();

    if (!userData) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    currency.diamond = await getDiamondCountByProductId(productId)

    // Validate and process based on the store
    if (store === 'GooglePlay') {
      if (!purchaseToken || !signature) {
        return res.status(400).json({ status: 'error', message: 'Incomplete data for Google Play' });
      }

      // Validate the purchase with Google Play (implement your verification logic)
      const isPurchaseValid = verifyGooglePlayPurchase(productId, purchaseToken, signature);

      if (!isPurchaseValid) {
        return res.status(400).json({ status: 'error', message: 'Google Play purchase verification failed' });
      }

      // Update user document
      await userRef.update({
        currency: { diamond: userData.currency.diamond + currency.diamond ,coin: userData.currency.coin},
      });

      // Get the updated currency after the update
      const updatedUserDoc = await userRef.get();
      const updatedUserData = updatedUserDoc.data();

      // Process and store the purchase details in the "purchases" collection for Google Play
      const googlePlayPurchase = {
        userId,
        store,
        productId,
        purchaseToken,
        signature,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      };

      await db.collection('purchases').add(googlePlayPurchase);

      return res.status(200).json({ status: 'success', message: 'Google Play top-up successful', data: { diamond: updatedUserData?.currency.diamond } });
    } else if (store === 'AppleAppStore') {
      if (!transactionId || !payload) {
        return res.status(400).json({ status: 'error', message: 'Incomplete data for Apple App Store' });
      }

      // Validate the purchase with Apple App Store (implement your verification logic)
      const isPurchaseValid = verifyAppleAppStorePurchase(productId, transactionId, payload);

      if (!isPurchaseValid) {
        return res.status(400).json({ status: 'error', message: 'Apple App Store purchase verification failed' });
      }

      // Update user document
      await userRef.update({
        currency: { diamond: userData.currency.diamond + currency.diamond ,coin: userData.currency.coin},
      });

      // Get the updated currency after the update
      const updatedUserDoc = await userRef.get();
      const updatedUserData = updatedUserDoc.data();

      // Process and store the purchase details in the "purchases" collection for Apple App Store
      const appleAppStorePurchase = {
        userId,
        store,
        productId,
        transactionId,
        payload,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      };

      await db.collection('purchases').add(appleAppStorePurchase);

      return res.status(200).json({ status: 'success', message: 'Apple App Store top-up successful', data: { diamond: updatedUserData?.currency.diamond } });
    } else {
      return res.status(400).json({ status: 'error', message: 'Invalid store specified' });
    }
  } catch (error) {
    console.error('Error processing top-up:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Simulated function to verify Google Play purchase
const verifyGooglePlayPurchase = (productId: unknown, purchaseToken: unknown, signature: unknown) => {
  // Perform actual verification with Google Play (implement your logic)
  // Simulated success
  console.log(productId, purchaseToken, signature);
  return true;
};

// Simulated function to verify Apple App Store purchase
const verifyAppleAppStorePurchase = (productId: unknown, transactionId: unknown, payload: unknown) => {
  // Perform actual verification with Apple App Store (implement your logic)
  // Simulated success
  console.log(productId, transactionId, payload);
  return true;
};

// Function to get the diamond count based on the productId
const getDiamondCountByProductId = (productId: string): number => {
  // Map productId to the corresponding diamond count
  const productIdToDiamondCount: Record<string, number> = {
    'com.ichigames.scrapdown.diamond20': 200,
    'com.ichigames.scrapdown.diamond80': 800,
    'com.ichigames.scrapdown.diamond200': 2000,
    'com.ichigames.scrapdown.diamond600': 6000,
    'com.ichigames.scrapdown.diamond1600': 16000,
    'com.ichigames.scrapdown.diamond4000': 40000,
    // Add more mappings as needed
  };

  return productIdToDiamondCount[productId] || 0;
};

// -------------------------------------------------------- [ Redeem Code ] ----------------------------------------------------------

// adding redeem codes
app.post('/add-redeem-code', async (req, res) => {
  try {
    const { name, code, expirationTime, reward } = req.body;

    // Validate the request body
    if (!name || !code || !expirationTime || !reward) {
      return res.status(400).json({ status: 'error', message: 'Code, expiration time, or reward is not defined' });
    }

    // Format expiration time to Firestore Timestamp
    const expirationTimestamp = admin.firestore.Timestamp.fromDate(new Date(expirationTime));

    // Check if the code already exists
    const codeSnapshot = await db.collection('redeemCodes').where('code', '==', code).get();

    if (!codeSnapshot.empty) {
      return res.status(409).json({ status: 'error', message: 'Code already exists' });
    }

    // Save redeem code to Firestore
    await saveRedeemCode(name, code, expirationTimestamp, reward);

    return res.status(201).json({ status: 'success', message: 'Redeem code added successfully' });
  } catch (error) {
    console.error('Error adding redeem code:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Function to save redeem code to Firestore
async function saveRedeemCode(name: string, code: string, expirationTime: admin.firestore.Timestamp, reward: unknown) {
  // Save redeem code document to Firestore
  await db.collection('redeemCodes').doc(code).set({
    name,
    expirationTime,
    reward
  });
}

// Redeem a code
app.post('/redeem-code', async (req, res) => {
  try {
    const { code, userId } = req.body;

    // Validate the request body
    if (!code || !userId) {
      return res.status(400).json({ status: 'error', message: 'Code or user ID is not defined' });
    }

    // Check if the code exists and is not expired
    const redeemCodeDoc = await db.collection('redeemCodes').doc(code).get();

    if (!redeemCodeDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'Code not found' });
    }

    const redeemCodeData = redeemCodeDoc.data();

    // Check if the code is expired
    const expirationTime = redeemCodeData?.expirationTime.toDate();

    if (expirationTime < new Date()) {
      return res.status(400).json({ status: 'error', message: 'Code is expired' });
    }

    // Check if the code has already been redeemed by the user
    const userRedeemedCodesRef = db.collection('userRedeemedCodes').doc(userId);
    const userRedeemedCodesDoc = await userRedeemedCodesRef.get();

    if (userRedeemedCodesDoc?.exists && userRedeemedCodesDoc?.data()?.redeemedCodes?.includes(code)) {
      return res.status(400).json({ status: 'error', message: 'Code has already been redeemed by this user' });
    }

    // Apply the code's reward to the user
    const userRef = db.collection(userCollection).doc(userId);

    // Get the user's current data
    const userDoc = await userRef.get();
    const userData = userDoc.data();

    // Update the user's coin reward
    const updatedCurrency = {
      ...userData?.currency,
      coin: userData?.currency.coin + redeemCodeData?.reward.coin,
      diamond: userData?.currency.diamond + redeemCodeData?.reward.diamond
    };

    // Update the user's spaceship and pilot inventory
    const updatedInventory = {
      spaceship: new Set(userData?.inventory?.spaceship ?? []),
      pilot: new Set(userData?.inventory?.pilot ?? [])
    };

    // Add the reward items to the inventory sets
    if (redeemCodeData?.reward?.spaceship) {
      if (Array.isArray(redeemCodeData.reward.spaceship)) {
        redeemCodeData.reward.spaceship.forEach((item: unknown) => updatedInventory.spaceship.add(item));
      } else {
        updatedInventory.spaceship.add(redeemCodeData.reward.spaceship);
      }
    }

    if (redeemCodeData?.reward?.pilot) {
      if (Array.isArray(redeemCodeData.reward.pilot)) {
        redeemCodeData.reward.pilot.forEach((item: unknown) => updatedInventory.pilot.add(item));
      } else {
        updatedInventory.pilot.add(redeemCodeData.reward.pilot);
      }
    }

    // Convert sets back to arrays
    const updatedInventoryArray = {
      spaceship: Array.from(updatedInventory.spaceship),
      pilot: Array.from(updatedInventory.pilot)
    };

    // Update the user's data in the database
    await userRef.update({
      currency: updatedCurrency,
      inventory: updatedInventoryArray
    });

    // Once the reward is applied, add the redeemed code to the user's redeemed codes list
    await userRedeemedCodesRef.set({
      redeemedCodes: admin.firestore.FieldValue.arrayUnion(code)
    }, { merge: true });

    // Return the updated currency and inventory
    return res.status(200).json({
      status: 'success',
      message: 'Code redeemed successfully',
      data: { name: redeemCodeData?.name, reward: redeemCodeData?.reward }
    });
  } catch (error) {
    console.error('Error redeeming code:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// -------------------------------------------------------- [ Email ] ----------------------------------------------------------

// Link Email Address
app.post('/user/link-email', async (req, res) => {
  try {
    const { userId, email } = req.body;

    if (!userId || !email) {
      return res.status(400).json({ status: 'error', message: 'userId, email, password, or confirmPassword is not defined' });
    }

    let token;
    let tokenSnapshot;
    const tokenRef = db.collection(credentialsCollection);
    do {
      token = generateRandomString(13);
      tokenSnapshot = await tokenRef.where('token', '==', token).get();
    } while (!tokenSnapshot.empty);

    // Save user credentials to the "credentials" collection
    await db.collection(credentialsCollection).doc(userId).set({
      platform: {
        'email': email
      },
      token: token
    }, { merge: true })

    // Send confirmation email
    await sendConfirmationEmail(email, token);

    // Update the email in the user collection
    const userRef = db.collection(userCollection).doc(userId);
    await userRef.update({ email });

    return res.status(201).json({ status: 'success', message: 'User registered and confirmation email sent successfully' });
  } catch (error) {
    console.error('Error registering user:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error during user registration' });
  }
});

// Change Email
app.put('/user/update-email', async (req, res) => {
  try {
    const { userId, password, newEmail } = req.body;

    // Check if userId, password, and newEmail are provided
    if (!userId || !password || !newEmail) {
      return res.status(400).json({ status: 'error', message: 'User ID, password, and new email are required' });
    }

    // Retrieve credentials data from the credentials collection
    const credentialsRef = db.collection(credentialsCollection).doc(userId);
    const credentialsDoc = await credentialsRef.get();

    // Check if the credentials document exists
    if (!credentialsDoc.exists) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Get the hashed password from the credentials document
    const credentialsData = credentialsDoc.data();
    const hashedPassword = credentialsData?.hashedPassword;

    // Validate the password
    const isValidPassword = await bcrypt.compare(password, hashedPassword);
    if (!isValidPassword) {
      return res.status(401).json({ status: 'error', message: 'Invalid password' });
    }

    // Check if the new email already exists in the credentials collection
    const emailSnapshot = await db.collection(credentialsCollection).where('email', '==', newEmail).get();
    if (!emailSnapshot.empty) {
      return res.status(409).json({ status: 'error', message: 'Email already in use' });
    }

    // Update email in the user document
    const userRef = db.collection(userCollection).doc(userId);
    await userRef.update({ email: newEmail, isConfirmed: false }); // Set isConfirmed to false

    let token;
    let tokenSnapshot;
    const tokenRef = db.collection(credentialsCollection);
    do {
      token = generateRandomString(13);
      tokenSnapshot = await tokenRef.where('token', '==', token).get();
    } while (!tokenSnapshot.empty);

    // Update email and generate a new token in the credentials document
    await credentialsRef.update({ email: newEmail, token: token });

    // Send confirmation email with the new token
    await sendConfirmationEmail(newEmail, token);

    // Send success response with email confirmation message
    return res.status(200).json({
      status: 'success',
      message: 'Email updated successfully. Confirmation email sent to the new email address.',
    });
  } catch (error) {
    console.error('Error updating email:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Function to send confirmation email using SMTP
async function sendConfirmationEmail(email: string, token: string) {
  try {
    const apiLink = `https://us-central1-scrapdown-647ec.cloudfunctions.net/webApi/api/v1/user/confirm/${token}`;
    // Create nodemailer transporter using SMTP settings
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', // Replace with your SMTP server host
      port: 587, // SMTP server port (usually 587 for TLS/STARTTLS)
      secure: false, // false for TLS/STARTTLS, true for SSL
      auth: {
        user: 'scrapdown@ichigames.com', // Replace with your SMTP username
        pass: 'tyfg zgkk urmd pujw' // Replace with your SMTP password
      }
    });

    // Define email options
    const mailOptions = {
      from: 'scrapdown@ichigames.com', // Replace with your email address
      to: email,
      subject: 'Confirmation Email',
      html: 
      `
      <html>
        <head>
          <style>
            .button-link {
            display: inline-block;
            padding: 10px 20px;
            background-color: #007bff;
            color: #ffffff;
            text-decoration: none;
            border-radius: 5px;
            border: none;
            cursor: pointer;
          }
          </style>
        </head>
          <body>
            <p>Hello ${email},</p>
            <p>Thank you for signing up! To complete your registration, please click the button below to confirm your email address:</p>
            <p><a href="${apiLink}" target="_blank" class="button-link">Confirm Email</a></p>
            <p>If you did not sign up for this service, you can safely ignore this email.</p>
            <p>For any inquiries or assistance, please contact us at:</p>
            <p>Ichigames Co.,Ltd<br>
            1/180 Vacharaphol Rd, Tha Raeng, Bang Khen, Bangkok 10220<br>
            Phone: 02 129 6370<br>
            Email: contact@ichigames.com</p>
          </body>
      </html>
      `
    };

    // Send the email
    await transporter.sendMail(mailOptions);
    console.log('Confirmation email sent successfully');
  } catch (error) {
    console.error('Error sending confirmation email:', error);
    throw error; // Throw error to handle it in the calling function
  }
}

// Confirm Email
app.get('/user/confirm/:token', async (req, res) => {
  try {
    // Extract token from request parameters
    const token = req.params.token;

    // Query the credentials collection to find the document with the matching token
    const credentialsRef = db.collection(credentialsCollection).where('token', '==', token);
    const credentialsSnapshot = await credentialsRef.get();

    // Check if the query returned any documents
    if (credentialsSnapshot.empty) {
      // Respond with an HTML error message
      const htmlError = 
      `
      <!DOCTYPE html>
      <html lang="en">
      
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Error</title>
          <style>
              body {
                  font-family: Arial, sans-serif;
                  background-color: #333333;
                  color: #ffffff;
                  margin: 0;
                  padding: 0;
              }
      
              .container {
                  max-width: 600px;
                  margin: 50px auto;
                  padding: 20px;
                  background-color: #222222;
                  border-radius: 8px;
                  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
              }
      
              h1 {
                  color: #ff0000;
                  text-align: center;
              }
      
              p {
                  color: #cccccc;
                  text-align: center;
              }
          </style>
      </head>
      
      <body>
          <div class="container">
              <h1>Error</h1>
              <p>Token not found.</p>
          </div>
      </body>
      
      </html>         
      `;
      return res.status(404).send(htmlError);
    }

    // Get the user ID from the first document
    const userId = credentialsSnapshot.docs[0].id;

    // Update the user document to mark email confirmation
    const userRef = db.collection(userCollection).doc(userId);
    await userRef.update({ isConfirmed: true });

    // Respond with an HTML success message
    const htmlResponse = 
    `
    <!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email Confirmation</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #333333;
            color: #ffffff;
            margin: 0;
            padding: 0;
        }

        .container {
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
            background-color: #222222;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }

        h1 {
            color: #ffffff;
            text-align: center;
        }

        p {
            color: #cccccc;
            text-align: center;
        }
    </style>
</head>

<body>
    <div class="container">
        <h1>Email Confirmed</h1>
        <p>Your email has been confirmed successfully.</p>
    </div>
</body>

</html>
    `;

    return res.status(200).send(htmlResponse);
  } catch (error) {
    console.error('Error confirming email:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Forgot password
app.post('/user/forgot-password', async (req, res) => {
  try {
    const email = req.body.email;

    // Check if email is provided
    if (!email) {
      return res.status(400).json({ status: 'error', message: 'Email is required' });
    }

    // Query the user collection to get the user's information
    const userRef = db.collection(credentialsCollection).where('email', '==', email);
    const userSnapshot = await userRef.get();

    // Check if the user exists
    if (userSnapshot.empty) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Get the user's data
    const userId = userSnapshot.docs[0].id;

    // Generate a reset token (you can use any method to generate a token)
    let resetToken;
    let resetTokenSnapshot;
    const resetTokenRef = db.collection(credentialsCollection);

    // Generate a unique resetToken
    do {
      resetToken = generateRandomString(10);
      resetTokenSnapshot = await resetTokenRef.where('resetToken', '==', resetToken).get();
    } while (!resetTokenSnapshot.empty);

    // Update the reset token in the credentials collection for the user
    await resetTokenRef.doc(userId).update({ resetToken });

    // Send reset password email
    await sendResetPasswordEmail(email, resetToken);

    return res.status(200).json({ status: 'success', message: 'Reset token generated successfully. Please check your email for further instructions.' });
  } catch (error) {
    console.error('Error generating reset token:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Function to send confirmation email using SMTP
async function sendResetPasswordEmail(email: string, resetToken: string) {
  try {
    // Create nodemailer transporter using SMTP settings
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', // Replace with your SMTP server host
      port: 587, // SMTP server port (usually 587 for TLS/STARTTLS)
      secure: false, // false for TLS/STARTTLS, true for SSL
      auth: {
        user: 'scrapdown@ichigames.com', // Replace with your SMTP username
        pass: 'tyfg zgkk urmd pujw' // Replace with your SMTP password
      }
    });

    // Email content
    const mailOptions = {
      from: 'scrapdown@ichigames.com',
      to: email,
      subject: 'Password Reset Request',
      html: 
      `
      <p>Hello ${email},</p>
      <p>You have requested a password reset.</p>
      <p>Please use the following token to reset your password</p>
      <p>Verify Code : <strong>${resetToken}</strong></p>
      <p>If you did not request this password reset, please ignore this email. Your account is still secure.</p>
      <p>Thank you,</p>
      <p>The Ichigames Co.,Ltd Team</p>
      `
    };

    // Send the email
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent: ' + info.response);
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

// Add monster names to a new collection
app.post('/add-monster-names', async (req, res) => {
  try {
    const { monsterNames } = req.body;

    // Check if monsterNames array is provided
    if (!Array.isArray(monsterNames) || monsterNames.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid request. Please provide an array of monster names' });
    }

    // Filter out duplicate monster names
    const uniqueMonsterNames = [...new Set(monsterNames)];

    // Add monster names to the new collection
    const batch = db.batch();
    const monsterNamesRef = db.collection(monsterCollection);

    uniqueMonsterNames.forEach((name) => {
      const newMonsterRef = monsterNamesRef.doc();
      batch.set(newMonsterRef, { name: name });
    });

    await batch.commit();

    return res.status(201).json({ status: 'success', message: 'Monster names added successfully to the new collection' });
  } catch (error) {
    console.error('Error adding monster names:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Define the endpoint to get items by name
app.get('/get-items-by-name/:name', async (req, res) => {
  try {
    const itemName = req.params.name;

    // Query the database to find items with the specified name
    const itemsSnapshot = await db.collection('items').where('name', '==', itemName).get();

    // Initialize an array to store item IDs and data
    const items: { id: string; data: admin.firestore.DocumentData; }[] = [];

    // Iterate over the retrieved items and push their IDs and data to the array
    itemsSnapshot.forEach((doc) => {
      items.push({ id: doc.id, data: doc.data() });
    });

    // Return the matching items in the response
    return res.status(200).json({ status: 'success', data: items });
  } catch (error) {
    console.error('Error fetching items by name:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});