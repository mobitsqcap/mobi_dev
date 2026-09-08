sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/Fragment"
], (Controller, JSONModel, MessageBox, MessageToast, Fragment) => {
    "use strict";

    return Controller.extend("glvlookup.controller.View1", {
        onInit() {
            var oModel = new JSONModel({
                data: []
            });

            this.getView().setModel(oModel, "tableModel");
            // Disable HANA Push button when application opens
            this.byId("btnHanaPush").setEnabled(false);
            this.byId("btnDownloadGL").setEnabled(false);

            // Warn before refresh/close
            this._beforeUnloadHandler = this._beforeUnload.bind(this);
            window.addEventListener("beforeunload", this._beforeUnloadHandler);
        },
        _beforeUnload: function (oEvent) {
            oEvent.preventDefault();
            oEvent.returnValue = "";
        },
        onExit: function () {
            window.removeEventListener("beforeunload", this._beforeUnloadHandler);
        },
        // Download Template
        onDownload: function () {

            var sUrl = sap.ui.require.toUrl("glvlookup/template/Sample-Template.xlsx");

            var oLink = document.createElement("a");
            oLink.href = sUrl;
            oLink.setAttribute("download", "Sample-Template.xlsx");
            oLink.setAttribute("target", "_self"); // Stay on the same page
            oLink.style.display = "none";

            document.body.appendChild(oLink);
            oLink.click();
            document.body.removeChild(oLink);

        },
        // Help Dialog
        onHelp: function () {

            if (!this._oHelpDialog) {

                Fragment.load({
                    id: this.getView().getId(),
                    name: "glvlookup.view.Help",
                    controller: this
                }).then(function (oDialog) {

                    this._oHelpDialog = oDialog;
                    this.getView().addDependent(oDialog);
                    oDialog.open();

                }.bind(this));

            } else {

                this._oHelpDialog.open();

            }
        },
        onCloseHelp: function () {

            this._oHelpDialog.close();
        },

        // Upload Excel
        onUpload: function (oEvent) {

            var aFiles = oEvent.getParameter("files");

            if (!aFiles || aFiles.length === 0) {
                return;
            }

            var oFile = aFiles[0];
            var oReader = new FileReader();

            oReader.onload = function (e) {

                try {

                    var sData = e.target.result;

                    var oWorkbook = XLSX.read(sData, {
                        type: "binary"
                    });

                    var sSheetName = oWorkbook.SheetNames[0];
                    var oWorksheet = oWorkbook.Sheets[sSheetName];

                    // Read Excel Data
                    var aData = XLSX.utils.sheet_to_json(oWorksheet);

                    // Check if Excel is empty
                    if (!aData || aData.length === 0) {
                        this.byId("btnHanaPush").setEnabled(false);
                        MessageBox.error("The uploaded Excel file is empty. Please upload a valid file with data.");
                        return;
                    }

                    // ===============================
                    // Template Validation
                    // ===============================

                    var aExpectedHeaders = [
                        "Company Code",
                        "Payment Type",
                        "Payment Sub Type",
                        "Host",
                        "GL Accounts",
                        "transaction_amount",
                        "host_mdr_amount",
                        "host_fee_payable",
                        "mobi_mdr_amount",
                        "mdr_revenue"
                    ];

                    var aActualHeaders = [];

                    if (oWorksheet["!ref"]) {

                        var oRange = XLSX.utils.decode_range(oWorksheet["!ref"]);

                        for (var c = oRange.s.c; c <= oRange.e.c; c++) {

                            var sCell = XLSX.utils.encode_cell({
                                r: oRange.s.r,
                                c: c
                            });

                            var oCell = oWorksheet[sCell];

                            aActualHeaders.push(oCell ? String(oCell.v).trim() : "");
                        }
                    }

                    var bValidTemplate = aExpectedHeaders.every(function (sHeader) {
                        return aActualHeaders.indexOf(sHeader) !== -1;
                    });

                    if (!bValidTemplate) {
                        MessageBox.error("Please upload valid template.");
                        return;
                    }

                    // ===============================
                    // Row Validations
                    // ===============================

                    var aErrors = [];
                    var oGLMap = {}; //for Duplicate GL Accounts
                    var oCombinationMap = {}; // For duplicate combination
                    var iDuplicateCount = 0;
                    var aDuplicateGLs = [];

                    aData.forEach(function (oRow, iIndex) {
                        var bInvalid = false;
                        var aRowErrors = [];

                        oRow.Status = "Valid";
                        var iRow = iIndex + 2;

                        var sCompanyCode = String(oRow["Company Code"] || "").trim();
                        var sPaymentType = String(oRow["Payment Type"] || "").trim().toUpperCase();
                        var sPaymentSubType = String(oRow["Payment Sub Type"] || "").trim().toUpperCase();
                        var sHost = String(oRow["Host"] || "").trim().toUpperCase();

                        // Update the row so the table displays the uppercase values
                        oRow["Payment Type"] = sPaymentType;
                        oRow["Payment Sub Type"] = sPaymentSubType;
                        oRow["Host"] = sHost;
                        var sGLAccounts = String(oRow["GL Accounts"] || "").trim();
                        // Duplicate GL Account Validation

                        // if (sGLAccounts) {
                        //     if (oGLMap[sGLAccounts]) {

                        //         iDuplicateCount++;

                        //         aDuplicateGLs.push(
                        //             sGLAccounts + " (Row " + iRow + ")"
                        //         );

                        //         aRowErrors.push("Duplicate GL Account");

                        //         bInvalid = true;

                        //     }
                        //     else {

                        //         oGLMap[sGLAccounts] = iRow;

                        //     }

                        // }

                        var sTransactionAmount = String(oRow["transaction_amount"] || "").trim();
                        var sHostMdrAmount = String(oRow["host_mdr_amount"] || "").trim();
                        var sHostFeePayable = String(oRow["host_fee_payable"] || "").trim();
                        var sMobiMdrAmount = String(oRow["mobi_mdr_amount"] || "").trim();
                        var sMdrRevenue = String(oRow["mdr_revenue"] || "").trim();
                        // Determine which sequence (X column) is selected
                        var sSequence = "";

                        if (sTransactionAmount === "X") {
                            sSequence = "transaction_amount";
                        } else if (sHostMdrAmount === "X") {
                            sSequence = "host_mdr_amount";
                        } else if (sHostFeePayable === "X") {
                            sSequence = "host_fee_payable";
                        } else if (sMobiMdrAmount === "X") {
                            sSequence = "mobi_mdr_amount";
                        } else if (sMdrRevenue === "X") {
                            sSequence = "mdr_revenue";
                        }

                        // Duplicate Combination Validation
                        var sCombinationKey =
                            sCompanyCode + "|" +
                            sPaymentType + "|" +
                            sPaymentSubType + "|" +
                            sHost + "|" +
                            sSequence + "|" +
                            sGLAccounts;

                        if (oCombinationMap[sCombinationKey]) {

                            aErrors.push(
                                "Row " + iRow +
                                ": Duplicate combination of Company Code, Payment Type, Payment Sub Type, Host and Sequence."
                            );

                            aRowErrors.push("Duplicate Combination");
                            bInvalid = true;

                        } else {

                            oCombinationMap[sCombinationKey] = iRow;

                        }

                        // Exactly one field should contain 'X'
                        var xCount = 0;

                        if (sTransactionAmount === "X") xCount++;
                        if (sHostMdrAmount === "X") xCount++;
                        if (sHostFeePayable === "X") xCount++;
                        if (sMobiMdrAmount === "X") xCount++;
                        if (sMdrRevenue === "X") xCount++;

                        if (xCount !== 1) {
                            aErrors.push(
                                "Row " + iRow +
                                ": Exactly one of Transaction Amount, Host MDR Amount, Host Fee Payable, Mobi MDR Amount or MDR Revenue must contain 'X'."

                            );
                            bInvalid = true;
                            oRow.Status = "Invalid combination of X";
                        }
                        // Mandatory Fields
                        if (!sCompanyCode) {
                            aErrors.push("Row " + iRow + ": Company Code is mandatory.");
                            aRowErrors.push("Company Code Mandatory");
                            bInvalid = true;
                        }

                        if (!sPaymentType) {
                            aErrors.push("Row " + iRow + ": Payment Type is mandatory.");
                            bInvalid = true;
                        }

                        if (!sPaymentSubType) {
                            aErrors.push("Row " + iRow + ": Payment Sub Type is mandatory.");
                            bInvalid = true;
                        }

                        if (!sHost) {
                            aErrors.push("Row " + iRow + ": Host is mandatory.");
                            bInvalid = true;
                        }

                        if (!sGLAccounts) {
                            aErrors.push("Row " + iRow + ": GL Accounts is mandatory.");
                            bInvalid = true;
                        }

                        // Company Code - 4 digits
                        if (sCompanyCode && !/^\d{4}$/.test(sCompanyCode)) {
                            aErrors.push("Row " + iRow + ": Company Code must contain exactly 4 digits.");
                            bInvalid = true;
                            aRowErrors.push("Invalid Company Code");
                        }

                        // Company Code - Allowed values only
                        var aAllowedCompanyCodes = ["1000", "2000", "3000", "4000", "5000"];

                        if (sCompanyCode &&
                            /^\d{4}$/.test(sCompanyCode) &&
                            !aAllowedCompanyCodes.includes(sCompanyCode)) {

                            aErrors.push(
                                "Row " + iRow +
                                ": Company Code must be one of 1000, 2000, 3000, 4000 or 5000."
                            );

                            bInvalid = true;
                            aRowErrors.push("Invalid Company Code");
                        }
                        // GL Accounts - 8 digits
                        if (sGLAccounts && !/^\d{8}$/.test(sGLAccounts)) {
                            aErrors.push("Row " + iRow + ": GL Accounts must contain exactly 8 digits.");
                            bInvalid = true;
                            // oRow.Status = "Invalid GL Account";
                            aRowErrors.push("Invalid GL Account");
                        }

                        // Payment Type
                        if (sPaymentType &&
                            sPaymentType !== "PAYINS" &&
                            sPaymentType !== "PAYOUT") {

                            aErrors.push("Row " + iRow + ": Payment Type must be either Payins or Payout.");
                            bInvalid = true;
                            // oRow.Status = "Invalid Payment Type";
                            aRowErrors.push("Invalid Payment Type");
                        }

                        // Payment Sub Type - String
                        if (sPaymentSubType && !/^[A-Za-z ]+$/.test(sPaymentSubType)) {
                            aErrors.push("Row " + iRow + ": Payment Sub Type must contain only alphabets.");
                            bInvalid = true;
                        }

                        // Host - String and max 20 characters
                        if (sHost && sHost.length > 20) {
                            aErrors.push("Row " + iRow + ": Host must not exceed 20 characters.");
                            bInvalid = true;
                            // oRow.Status = "Host Length Exceeded";
                            aRowErrors.push("Host Length Exceeded");
                        }

                        // Validate only X or blank
                        var aFields = [
                            { value: sTransactionAmount, name: "Transaction Amount" },
                            { value: sHostMdrAmount, name: "Host MDR Amount" },
                            { value: sHostFeePayable, name: "Host Fee Payable" },
                            { value: sMobiMdrAmount, name: "Mobi MDR Amount" },
                            { value: sMdrRevenue, name: "MDR Revenue" }
                        ];

                        var xCount = 0;

                        aFields.forEach(function (field) {
                            if (field.value !== "" && field.value !== "X") {
                                aErrors.push(
                                    "Row " + iRow + ": " + field.name + " must contain only 'X' or be blank."
                                );
                                bInvalid = true;
                                // oRow.Status = "Invalid X Value";
                                aRowErrors.push("invalid combination of X");
                            }

                            if (field.value === "X") {
                                xCount++;
                            }
                        });

                        if (xCount !== 1) {
                            aErrors.push(
                                "Row " + iRow +
                                ": Exactly one of Transaction Amount, Host MDR Amount, Host Fee Payable, Mobi MDR Amount or MDR Revenue must contain 'X'."
                            );
                            bInvalid = true;

                        }
                        if (aRowErrors.length > 0) {
                            oRow.Status = aRowErrors.join(", ");
                            oRow.rowHighlight = "Error";
                        } else {
                            oRow.Status = "Valid";
                            oRow.rowHighlight = "Success";
                        }
                    });

                    if (aErrors.length > 0) {

                        var sSummary =
                            "Total Records : " + aData.length;

                        this.byId("uploadSummary").setVisible(false);
                        this.byId("uploadSummary").setText("");

                    }

                    // Bind data to table
                    var oModel = this.getView().getModel("tableModel");
                    var sSummary =
                        "Total Records : " + aData.length;
                    this.byId("uploadSummary").setVisible(false);
                    this.byId("uploadSummary").setText("");
                    oModel.setData({
                        data: aData
                    });

                    oModel.refresh(true);
                    this.byId("recordSummary").setText(
                        "Total Records uploaded from Excel : " + aData.length
                    );

                    this.byId("recordSummary").setVisible(true);
                    // Enable HANA Push button
                    //this.byId("btnHanaPush").setEnabled(true);
                    if (aErrors.length > 0) {
                        this.byId("btnHanaPush").setEnabled(false);
                    } else {
                        this.byId("btnHanaPush").setEnabled(true);
                    }

                    MessageToast.show("Excel uploaded successfully.");

                } catch (oError) {

                    console.error(oError);
                    MessageBox.error("Please upload valid template.");

                }

            }.bind(this);

            oReader.readAsBinaryString(oFile);

        },
        onhanapush: async function () {
            const oUploadButton = this.byId("btnHanaPush");
            try {

                const aData = this.getView()
                    .getModel("tableModel")
                    .getProperty("/data");
                if (!aData || aData.length === 0) {
                    MessageBox.error("Please upload Excel file.");
                    return;
                }
                oUploadButton.setEnabled(false);
                const aPayload = aData.map(row => ({
                    GUID: crypto.randomUUID(),

                    COMPANY_CODE: String(row["Company Code"] || ""),
                    PAYMENT_TYPE: String(row["Payment Type"] || ""),
                    PAYMENT_SUB_TYPE: String(row["Payment Sub Type"] || ""),
                    HOST_NAME: String(row["Host"] || ""),

                    TXN_AMOUNT: String(row["transaction_amount"] || ""),
                    HOST_MDR_AMOUNT: String(row["host_mdr_amount"] || ""),
                    HOST_FEE_PAYABLE: String(row["host_fee_payable"] || ""),
                    MOBI_MDR_AMOUNT: String(row["mobi_mdr_amount"] || ""),
                    MDR_REVENUE: String(row["mdr_revenue"] || ""),

                    GL_Accounts: String(row["GL Accounts"] || ""),

                    Status: "A",

                    CREATED_BY: "SYSTEM",
                    CREATED_TIMESTAMP: new Date().toISOString(),

                    CHANGED_BY: "SYSTEM",
                    CHANGED_TIMESTAMP: new Date().toISOString()
                }));

                const oModel = this.getOwnerComponent().getModel();
                const oAction = oModel.bindContext(
                    "/uploadExcelData(...)",
                    null,
                    {
                        $$groupId: "$direct"
                    }
                );
                oAction.setParameter(
                    "data",
                    aPayload
                );
                await oAction.execute("$direct");

                // Update the Status column in the table
                aData.forEach(function (row) {
                    row.Status = "A";    // or "Success" if you want to display Success
                });

                // Refresh the table
                this.getView().getModel("tableModel").refresh(true);
                this.byId("uploadSummary").setText(
                    "Valid Records : " + aPayload.length +
                    "\nDuplicate Records : 0"
                );

                this.byId("uploadSummary").setVisible(true);
                MessageToast.show(
                    aPayload.length + " records uploaded successfully"
                );
                this.byId("fileUploader").clear();
                this.byId("btnHanaPush").setEnabled(false);
                oUploadButton.setEnabled(false);
            }
            catch (e) {
                console.error(e);
                var sError = e.message || "Upload failed";

                try {
                    var sTarget = e.error["@$ui5.originalMessage"].target;
                    var oSummary = JSON.parse(sTarget);
                    var sSummary =
                        "Valid Records : " + oSummary.validRecords;

                    if (oSummary.duplicateRecords > 0) {
                        sSummary +=
                            "\nDuplicate Records : " +
                            oSummary.duplicateRecords;
                    }

                    if (oSummary.invalidHostNames &&
                        oSummary.invalidHostNames.length > 0) {

                        sSummary +=
                            "\nInvalid Hosts : " +
                            oSummary.invalidHostNames.join(", ");
                    }

                    this.byId("uploadSummary").setText(sSummary);
                    this.byId("uploadSummary").setVisible(true);
                    var aTableData = this.getView().getModel("tableModel").getProperty("/data");
 var sMessage = e.error.message;

if (sMessage === "Duplicate records found.") {

    var aDuplicateData = oSummary.duplicateData || [];

    aTableData.forEach(function (row) {

        var bIsDuplicate = aDuplicateData.some(function (duplicate) {

            return (
                String(row["Company Code"] || "").trim() === String(duplicate.COMPANY_CODE || "").trim() &&
                String(row["Payment Type"] || "").trim() === String(duplicate.PAYMENT_TYPE || "").trim() &&
                String(row["Payment Sub Type"] || "").trim() === String(duplicate.PAYMENT_SUB_TYPE || "").trim() &&
                String(row["Host"] || "").trim() === String(duplicate.HOST_NAME || "").trim() &&
                String(row["transaction_amount"] || "").trim() === String(duplicate.TXN_AMOUNT || "").trim() &&
                String(row["host_mdr_amount"] || "").trim() === String(duplicate.HOST_MDR_AMOUNT || "").trim() &&
                String(row["host_fee_payable"] || "").trim() === String(duplicate.HOST_FEE_PAYABLE || "").trim() &&
                String(row["mobi_mdr_amount"] || "").trim() === String(duplicate.MOBI_MDR_AMOUNT || "").trim() &&
                String(row["mdr_revenue"] || "").trim() === String(duplicate.MDR_REVENUE || "").trim() &&
                String(row["GL Accounts"] || "").trim() === String(duplicate.GL_Accounts || "").trim()
            );

        });

        if (bIsDuplicate) {

            row.rowHighlight = "Error";
            row.Status = "Duplicate";

        } else {

            row.rowHighlight = "Success";
            row.Status = "Valid";

        }

    });
}
                    else if (sMessage.startsWith("Invalid Host(s):")) {

                        var sHostList = sMessage.replace("Invalid Host(s):", "").trim();

                        var aInvalidHosts = sHostList.split(",").map(function (host) {
                            return host.trim().toUpperCase();
                        });

                        aTableData.forEach(function (row) {

                            if (aInvalidHosts.indexOf(String(row["Host"]).trim().toUpperCase()) !== -1) {

                                row.rowHighlight = "Error";
                                row.Status = "Invalid Host";

                            }

                        });

                    }

                    this.getView().getModel("tableModel").refresh(true);
                } catch (err) {
                    console.log(err);
                }
                var sErrorText = "";

                if (oSummary.duplicateRecords > 0) {

                    sErrorText =
                        "Duplicate Records : " + oSummary.duplicateRecords;

                } else if (oSummary.invalidHosts > 0) {

                    sErrorText =
                        "Invalid Hosts : " + oSummary.invalidHosts;

                } else {

                    sErrorText = sError;
                }

                // MessageBox.error(sErrorText);
                var sPopupMessage = "Data not pushed to Database.";

                if (sErrorText) {
                    sPopupMessage += "\n\n" + sErrorText;
                }

                MessageBox.error(sPopupMessage, {
                    title: "Upload Failed"
                });
                oUploadButton.setEnabled(false);

            }
        },
        onDisplayGLData: async function () {

            try {

                var oModel = this.getOwnerComponent().getModel();

                var oAction = oModel.bindContext("/displayGLData(...)");

                await oAction.execute();

                var oResult = oAction.getBoundContext().getObject();

                var aRecords = oResult.value || oResult;

                var aTableData = aRecords.map(function (row) {
                    return {
                        "Company Code": row.COMPANY_CODE,
                        "Payment Type": row.PAYMENT_TYPE,
                        "Payment Sub Type": row.PAYMENT_SUB_TYPE,
                        "Host": row.HOST_NAME,
                        "transaction_amount": row.TXN_AMOUNT,
                        "host_mdr_amount": row.HOST_MDR_AMOUNT,
                        "host_fee_payable": row.HOST_FEE_PAYABLE,
                        "mobi_mdr_amount": row.MOBI_MDR_AMOUNT,
                        "mdr_revenue": row.MDR_REVENUE,
                        "GL Accounts": row.GL_Accounts,
                        "Status": row.Status
                    };
                });

                this.getView().getModel("tableModel").setProperty("/data", aTableData);
                this.byId("btnDownloadGL").setEnabled(true);
                // Disable Upload button after displaying DB data
                this.byId("btnHanaPush").setEnabled(false);

                sap.m.MessageToast.show("GL Data Loaded Successfully");

            } catch (e) {

                console.error(e);

                sap.m.MessageToast.show("Unable to load GL Data");

            }

        },
        onDownloadGLData: function () {

            var aData = this.getView()
                .getModel("tableModel")
                .getProperty("/data");

            if (!aData || aData.length === 0) {
                sap.m.MessageBox.information("No GL Data available.");
                return;
            }

            // Arrange columns in required order
            var aExcelData = aData.map(function (oRow) {
                return {
                    "Company Code": oRow["Company Code"],
                    "Payment Type": oRow["Payment Type"],
                    "Payment Sub Type": oRow["Payment Sub Type"],
                    "Host": oRow["Host"],
                    "Transaction Amount": oRow["transaction_amount"],
                    "Host MDR Amount": oRow["host_mdr_amount"],
                    "Host Fee Payable": oRow["host_fee_payable"],
                    "Mobi MDR Amount": oRow["mobi_mdr_amount"],
                    "MDR Revenue": oRow["mdr_revenue"],
                    "GL Accounts": oRow["GL Accounts"],
                    "Status": oRow["Status"]
                };
            });

            // Create worksheet
            var oWorksheet = XLSX.utils.json_to_sheet(aExcelData);

            // Create workbook
            var oWorkbook = XLSX.utils.book_new();

            XLSX.utils.book_append_sheet(
                oWorkbook,
                oWorksheet,
                "GL Data"
            );

            // Download Excel
            XLSX.writeFile(
                oWorkbook,
                "GL_Data.xlsx"
            );

            sap.m.MessageToast.show("GL Data downloaded successfully.");
            // Disable buttons after download
            this.byId("btnDownloadGL").setEnabled(false);
            this.byId("btnDisplay").setEnabled(false);
        }
    });

});