const cds = require("@sap/cds");

module.exports = cds.service.impl(async function () {

    console.log("========== PaymentService Started ==========");

    const db = await cds.connect.to("db");
    console.log("Database connected:", db.name);
const MOBI_DB_MASTER = db.entities["mobi.db.MOBI_DB_MASTER"];
const valuelookup = db.entities["mobi.db.MOBI_DB_GLAccounts"];

console.log("MASTER Entity:", MOBI_DB_MASTER);
console.log("GL Entity:", valuelookup);
    // const { valuelookup } = cds.entities("VlGlAccounts");
    console.log("Entity loaded:", valuelookup);

    this.on("uploadExcelData", async (req) => {

        console.log("========== uploadExcelData START ==========");
        const tx = cds.tx({});
        try {
            console.log("Request received at:", new Date().toISOString());

            console.log("Incoming Request:");
            console.log(JSON.stringify(req.data, null, 2));

            const data = req.data.data;

            if (!data || data.length === 0) {
                console.log("No data received.");
                return "NO DATA";
            }

            console.log("Total Records:", data.length);

            console.log("First Record:");
            console.log(JSON.stringify(data[0], null, 2));

            console.log("Last Record:");
            console.log(JSON.stringify(data[data.length - 1], null, 2));

            console.log("Starting HANA Insert...");

            console.time("HANA Insert Time");

 const { valuelookup } = cds.entities("VlGlAccounts");

const duplicateRecords = [];
const invalidHosts = [];

for (const row of data) {

    const existing = await SELECT.one
        .from(valuelookup)
        .where({
            COMPANY_CODE: row.COMPANY_CODE,
            PAYMENT_TYPE: row.PAYMENT_TYPE,
            PAYMENT_SUB_TYPE: row.PAYMENT_SUB_TYPE,
            HOST_NAME: row.HOST_NAME,
            TXN_AMOUNT: row.TXN_AMOUNT,
            HOST_MDR_AMOUNT: row.HOST_MDR_AMOUNT,
            HOST_FEE_PAYABLE: row.HOST_FEE_PAYABLE,
            MOBI_MDR_AMOUNT: row.MOBI_MDR_AMOUNT,
            MDR_REVENUE: row.MDR_REVENUE,
            GL_Accounts: row.GL_Accounts,
            Status: "A"
        });

    if (existing) {

        duplicateRecords.push({
            COMPANY_CODE: row.COMPANY_CODE,
            PAYMENT_TYPE: row.PAYMENT_TYPE,
            PAYMENT_SUB_TYPE: row.PAYMENT_SUB_TYPE,
            HOST_NAME: row.HOST_NAME,
            TXN_AMOUNT: row.TXN_AMOUNT,
            HOST_MDR_AMOUNT: row.HOST_MDR_AMOUNT,
            HOST_FEE_PAYABLE: row.HOST_FEE_PAYABLE,
            MOBI_MDR_AMOUNT: row.MOBI_MDR_AMOUNT,
            MDR_REVENUE: row.MDR_REVENUE,
            GL_Accounts: row.GL_Accounts
        });

    }

    // HOST validation
    const host = row.HOST_NAME.trim().toUpperCase();

    const hostExists = await SELECT.one
        .from(MOBI_DB_MASTER)
        .where`UPPER(ID) = ${host}`;

    if (!hostExists) {
        invalidHosts.push(row.HOST_NAME);
    }
}


// Duplicate records found
if (duplicateRecords.length > 0) {

    req.error({
        code: 400,
        message: "Duplicate records found.",
        target: JSON.stringify({
            totalRecords: data.length,
            validRecords: data.length - duplicateRecords.length,
            duplicateRecords: duplicateRecords.length,
            duplicateData: duplicateRecords
        })
    });

    return;
}

if (invalidHosts.length > 0) {

    const uniqueInvalidHosts = [...new Set(invalidHosts)];

    req.error({
        code: 400,
        message: "Invalid Host(s): " + uniqueInvalidHosts.join(", "),
        target: JSON.stringify({
            totalRecords: data.length,
            validRecords: data.length - uniqueInvalidHosts.length,
            duplicateRecords: 0,
            invalidHosts: uniqueInvalidHosts.length,
            invalidHostNames: uniqueInvalidHosts
        })
    });

    return;
}
            for (const row of data) {

                const existingActive = await SELECT.one
                    .from(valuelookup)
                    .where({
                        COMPANY_CODE: row.COMPANY_CODE,
                        PAYMENT_TYPE: row.PAYMENT_TYPE,
                        PAYMENT_SUB_TYPE: row.PAYMENT_SUB_TYPE,
                        HOST_NAME: row.HOST_NAME,
                        TXN_AMOUNT: row.TXN_AMOUNT,
                        HOST_MDR_AMOUNT: row.HOST_MDR_AMOUNT,
                        HOST_FEE_PAYABLE: row.HOST_FEE_PAYABLE,
                        MOBI_MDR_AMOUNT: row.MOBI_MDR_AMOUNT,
                        MDR_REVENUE: row.MDR_REVENUE,
                        Status: "A"
                    });

                if (existingActive) {

                    await UPDATE(valuelookup)
                        .set({
                            Status: "I",
                            CHANGED_BY: row.CHANGED_BY,
                            CHANGED_TIMESTAMP: new Date()
                        })
                        .where({
                            COMPANY_CODE: row.COMPANY_CODE,
                            PAYMENT_TYPE: row.PAYMENT_TYPE,
                            PAYMENT_SUB_TYPE: row.PAYMENT_SUB_TYPE,
                            HOST_NAME: row.HOST_NAME,
                            TXN_AMOUNT: row.TXN_AMOUNT,
                            HOST_MDR_AMOUNT: row.HOST_MDR_AMOUNT,
                            HOST_FEE_PAYABLE: row.HOST_FEE_PAYABLE,
                            MOBI_MDR_AMOUNT: row.MOBI_MDR_AMOUNT,
                            MDR_REVENUE: row.MDR_REVENUE,
                            Status: "A"
                        });
                }

                // New record will be Active
                row.Status = "A";
            }

            // Insert only if no duplicates exist
            const result = await cds.db.run(
                INSERT.into(valuelookup).entries(data),
                req
            );

            console.timeEnd("HANA Insert Time");

            console.log("HANA Insert Completed Successfully.");

            console.log("Insert Result:");
            console.log(result);

            console.log(`${data.length} records inserted successfully.`);

            console.log("========== uploadExcelData END ==========");

            return {
                status: "SUCCESS",
                message: `${data.length} records inserted successfully`
            };

        } catch (error) {

            console.error("========== ERROR OCCURRED ==========");
            console.error("Time:", new Date().toISOString());
            console.error("Error Name:", error.name);
            console.error("Error Message:", error.message);
            console.error("Error Code:", error.code);

            if (error.stack) {
                console.error("Stack Trace:");
                console.error(error.stack);
            }

            console.error("========== END ERROR ==========");

            req.error({
                code: 500,
                message: error.message
            });
        }

    });

    this.on("displayGLData", async (req) => {

    try {

        const data = await SELECT.from(valuelookup);

        return data;

    } catch (error) {

        req.error({
            code: 500,
            message: error.message
        });

    }

});

});