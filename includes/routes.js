/*
ROUTES

These functions are used in the app.js file to the support the express routes used on different pages.

*/

// Modules needed
const fs = require('fs');
const mysql = require('mysql');
const pug = require('pug');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const {OAuth2Client} = require('google-auth-library');

// Variables
const dbPrefix = "slo_";
module.exports.dbPrefix = dbPrefix;

// Mysql login details
const logins = require('../logins');

// MYSQL Promisify
class Database {
    constructor( config ) {
        this.connection = mysql.createConnection( config );
    }
    query( sql, args ) {
        return new Promise( ( resolve, reject ) => {
            this.connection.query( sql, args, ( err, rows, fields ) => {
                if ( err )
                    return reject( err );
                resolve( {rows: rows, fields: fields} );
            } );
        } );
    }
    close() {
        return new Promise( ( resolve, reject ) => {
            this.connection.end( err => {
                if ( err )
                    return reject( err );
                resolve();
            } );
        } );
    }
}

var database = new Database(logins.mysqlOptions(dbPrefix));


// Display admin page
function displayAdmin(data, req, res, next) {

    // Select all reviews of program
    let query = "SELECT "+
        dbPrefix+"Approve.id, "+
        dbPrefix+"Approve.date, "+
        dbPrefix+"Approve.actions, "+
        dbPrefix+"Approve.notes, "+
        dbPrefix+"Approve.csv, "+
        dbPrefix+"Faculty.firstName, "+
        dbPrefix+"Faculty.lastName, "+
        dbPrefix+"Faculty.email, "+
        dbPrefix+"Depts.name AS deptName, "+
        dbPrefix+"Program.name AS progName "+
        "FROM "+dbPrefix+"Approve "+
        "JOIN "+dbPrefix+"Faculty on "+
        dbPrefix+"Faculty.id = "+dbPrefix+"Approve.facultyID "+
        "JOIN "+dbPrefix+"Depts on "+
        dbPrefix+"Approve.deptID = "+dbPrefix+"Depts.id "+
        "JOIN "+dbPrefix+"Program ON "+
        dbPrefix+"Program.progID = "+dbPrefix+"Approve.progID;";

    database.query(query).then(function(rows){
        data.reviews = Object.values(JSON.parse(JSON.stringify(rows)))[0];
    }).then(function(result){

        // Select all users
        query = "SELECT "+
            dbPrefix+"Users.id, "+
            dbPrefix+"Faculty.firstName, "+
            dbPrefix+"Faculty.lastName, "+
            dbPrefix+"Faculty.email, "+
            dbPrefix+"Users.role "+
            "FROM "+dbPrefix+"Users "+
            "JOIN "+dbPrefix+"Faculty on "+dbPrefix+"Users.facultyID = "+dbPrefix+"Faculty.id";

        return database.query(query);

    }).then(function(rows){
        
        data.users = Object.values(JSON.parse(JSON.stringify(rows)))[0];
        
        // Create CSV of all program reviews

        // CSV Export filename
        let date = new Date();
        data.csvPath = data.linkPath = 'csv/' + 
            date.getFullYear() + "-" + 
            ('0' + (date.getMonth() + 1)).slice(-2) + "-" +
            ('0' + date.getDate()).slice(-2) + "-" +
            ('0' + date.getHours()).slice(-2) + "-" +
            ('0' + date.getMinutes()).slice(-2) + "-" +
            ('0' + date.getSeconds()).slice(-2) + ".csv";
        data.csvPath = 'public/' + data.csvPath;

        var header = [];
        header.push({id: 'dept', title: 'DEPARTMENT'});
        header.push({id: 'program', title: 'PROGRAM'});
        header.push({id: 'date', title: 'DATE'});
        header.push({id: 'faculty', title: 'FACULTY NAME'});
        header.push({id: 'email', title: 'EMAIL'});
        header.push({id: 'actions', title: 'ACTIONS NEEDED/TAKEN'});
        header.push({id: 'notes', title: 'NOTES'});

        const csvWriter = createCsvWriter({
            path: data.csvPath,
            header: header
        });

        // Add records
        data.records = [];
        let record = {};
        data.reviews.forEach(function(review){
            record = {};
            record.dept = review.deptName;
            record.program = review.progName;
            record.date = review.date.slice(0,10);
            record.faculty = review.firstName + " " + review.lastName;
            record.email = review.email;
            record.actions = (review.actions) ? "Yes" : "No";
            record.notes = Buffer.from(review.notes).toString('utf-8');
            data.records.push(record);
        });

        return csvWriter.writeRecords(data.records);

    }).then(function(result){

        // Compile and display admin page
        const compiledFunction = pug.compileFile('./views/admin.pug');

        const pageOutput = compiledFunction({
            title: 'Program SLO',
            subtitle: 'Linguistic Analysis Tool',
            reviews: data.reviews,
            users: data.users,
            csv: data.linkPath,
            role: data.role,
        });

        res.write(pageOutput);
        res.end();

    }).catch(function(error) {
        console.log(error);
    });

}

module.exports.displayAdmin = displayAdmin;

// Authentication
function authenticate(token) {

    return new Promise(function(resolve, reject) {
        
        // if token variable there
        if (token) {
    
            // Confirm authentication
            const client = new OAuth2Client(logins.googleClientId);
            async function verify() {
                const ticket = await client.verifyIdToken({
                    idToken: token,
                    audience: logins.googleClientId,  // Specify the CLIENT_ID of the app that accesses the backend
                    // Or, if multiple clients access the backend:
                    //[CLIENT_ID_1, CLIENT_ID_2, CLIENT_ID_3]
                });
                const payload = ticket.getPayload();
                const userid = payload['sub'];
                // If request specified a G Suite domain:
                //const domain = payload['hd'];
        
                if (payload) {
        
                    // Set up query
                    let google_id_query = "SELECT DISTINCT "+
                        dbPrefix+"Users.role "+
                        "FROM "+dbPrefix+"Users "+
                        "WHERE googleID = "+mysql.escape(payload['sub'])+";";
        
                    database.query(google_id_query).then(function(result){
    
                        // console.log('valid');
                        // console.log(result.rows[0].role);
    
                        resolve(result.rows[0].role);
    
                    })
    
                } else {
                    resolve();
                }
            }
            verify().catch(console.error);
        } else {
            resolve();
        }

    });
    

}

module.exports.authenticate = authenticate;