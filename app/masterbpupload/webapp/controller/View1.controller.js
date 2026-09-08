// sap.ui.define(

//   [

//     "sap/ui/core/mvc/Controller",

//     "sap/ui/model/json/JSONModel",

//     "sap/ui/core/MessageType",

//     "sap/m/MessageToast",

//     "sap/m/MessageBox"

//   ],

//   function (Controller, JSONModel, MessageType, MessageToast, MessageBox) {

//     "use strict";

//     /* ================================================================== */
//     /* Template field definitions - ALL MOBI_DB_MASTER fields              */
//     /* (template columns appear in exactly this DB order)                  */
//     /* required : validated as mandatory by MasterValidator / this app     */
//     /* system   : accepted in the sheet but ALWAYS assigned by the backend */
//     /* ================================================================== */

//     var TEMPLATE_FIELDS = [

//       /* ---- core fields ---- */
//       { key: "id",                          aliases: ["id", "merchant_id"],                        required: true,  maxLen: 20,  sample: "MCHT00012345" },
//       { key: "audit_id",                    aliases: ["audit_id"],                                 required: false, maxLen: 36,  sample: "(auto by backend)" },
//       { key: "mobi_portal_code",            aliases: ["mobi_portal_code", "portal_code"],          required: true,  maxLen: 2,   sample: "MY" },
//       { key: "sap_company_code",            aliases: ["sap_company_code", "company_code"],         required: true,  maxLen: 4,   sample: "2000" },
//       { key: "type",                        aliases: ["type", "merchant_type"],                    required: true,  maxLen: 20,  sample: "Domestic" },
//       { key: "address1",                    aliases: ["address1", "address"],                      required: false, maxLen: 255, sample: "LOT 10, JALAN BUKIT" },
//       { key: "postal_code",                 aliases: ["postal_code", "zip"],                       required: false, maxLen: 10,  sample: "50450" },
//       { key: "country",                     aliases: ["country", "country_name"],                  required: false, maxLen: 80,  sample: "Malaysia" },
//       { key: "country_code",                aliases: ["country_code", "country_code_in_sap"],      required: true,  maxLen: 2,   sample: "MY" },
//       { key: "business_reg_no_tin",         aliases: ["business_reg_no_tin", "tin"],               required: false, maxLen: 50,  sample: "123456789012345" },
//       { key: "master_name",                 aliases: ["master_name", "merchant_name"],             required: true,  maxLen: 40,  sample: "ABC RETAIL SDN BHD" },
//       { key: "external_bp_number",          aliases: ["external_bp_number", "external_bp"],        required: true,  maxLen: 20,  sample: "MCHT00012345" },
//       { key: "bp_number",                   aliases: ["bp_number", "bp", "sap_bp_number"],         required: true,  maxLen: 10,  sample: "10004567" },

//       /* ---- optional master fields: filled = used as entered, blank = derived ---- */
//       { key: "grouping",                    aliases: ["grouping", "bp_grouping"],                  required: false, maxLen: 4,   sample: "blank = derived" },
//       { key: "name",                        aliases: ["name", "bp_name"],                          required: false, maxLen: 40,  sample: "blank = master_name" },
//       { key: "street",                      aliases: ["street"],                                   required: false, maxLen: 60,  sample: "blank = address1" },
//       { key: "country_region",              aliases: ["country_region", "region"],                 required: false, maxLen: 10,  sample: "blank = country_code" },
//       { key: "bp_tax_long_number",          aliases: ["bp_tax_long_number", "tax_number"],         required: false, maxLen: 50,  sample: "blank = business_reg_no_tin" },
//       { key: "language",                    aliases: ["language", "language_key"],                 required: false, maxLen: 2,   sample: "blank = EN" },
//       { key: "reconciliation_account",      aliases: ["reconciliation_account", "recon_account"],  required: false, maxLen: 10,  sample: "" },
//       { key: "check_duplicate_invoice_ind", aliases: ["check_duplicate_invoice_ind", "check_dup_inv_ind"], required: false, maxLen: 1, sample: "blank = X" },
//       { key: "purchasing_organization",     aliases: ["purchasing_organization", "purchase_org", "purch_org"], required: false, maxLen: 4, sample: "blank = company code" },
//       { key: "gr_based_invoice_ind",        aliases: ["gr_based_invoice_ind", "gr_based_inv_ind"], required: false, maxLen: 1,   sample: "X or blank" },
//       { key: "business_partner_category",   aliases: ["business_partner_category", "bp_category"], required: false, maxLen: 1,   sample: "1 = Org, 2 = Person" },
//       { key: "business_partner_role",       aliases: ["business_partner_role", "bp_role"],         required: false, maxLen: 20,  sample: "" },
//       { key: "sales_organization",          aliases: ["sales_organization", "sales_org"],          required: false, maxLen: 4,   sample: "blank = company code" },
//       { key: "active_flag",                 aliases: ["active_flag", "active"],                    required: false, maxLen: 1,   sample: "blank = X" },

//       /* ---- system fields: sheet values are ignored, backend assigns them ---- */
//       { key: "status_code",                 aliases: ["status_code"],                              required: false, maxLen: 3,   sample: "forced to 063" },
//       /* file_id / file_name intentionally NOT in the template: backend fills them in the DB */
//       { key: "record_number",               aliases: ["record_number"],                            required: false, maxLen: 10,  sample: "(auto by backend)" },
//       { key: "bp_creation_date",            aliases: ["bp_creation_date"],                         required: false, maxLen: 50,  sample: "blank = now (e.g. 2025-08-01)" }

//       /* host_name removed from template + table per request (DB column stays, backend default) */

//     ];

//     var VALID_PORTAL_CODES  = ["SG", "MY", "IN", "ID", "AE"];

//     var VALID_COMPANY_CODES = ["1000", "2000", "3000", "4000", "5000"];

//     var VALID_TYPES         = { domestic: "Domestic", international: "International", host: "Host" };

//     /* ISO 3166-1 alpha-2 (same as Constants.VALID_COUNTRY_CODES) */

//     var VALID_COUNTRY_CODES = ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
//       "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
//       "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
//       "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
//       "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
//       "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
//       "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW").split(" ");

//     var EXPONENTIAL_RE = /^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/;

//     return Controller.extend("masteruploadbp.controller.View1", {

//       onInit: function () {

//         this.getView().setModel(new JSONModel({ data: [] }), "tableModel");

//         this._csrfToken = null;

//         /* ---- the PAGE scrolls vertically; the TABLE scrolls horizontally ---- */
//         var oTable = this.byId("idTable");
//         if (oTable) {
//           // (a) Stop columns from shrinking to fit the screen -> HORIZONTAL scrollbar (on the table)
//           oTable.getColumns().forEach(function (oCol) {
//             var iW = parseInt(oCol.getWidth(), 10);
//             if (!isNaN(iW)) { oCol.setMinWidth(iW); }
//           });
//           // (b) Fixed mode; the row count is set to the data length in onUpload,
//           //     so the table grows and the PAGE scrolls down to show all rows.
//           oTable.setVisibleRowCountMode(sap.ui.table.VisibleRowCountMode.Fixed);
//           oTable.setVisibleRowCount(15);
//         }

//         /* "Leave site?" warning on browser Back / tab close while records are loaded */
//         this._fnBeforeUnload = function (oEvent) {

//           var aRows = (this.getView().getModel("tableModel").getProperty("/data")) || [];

//           if (aRows.length) {

//             /* modern browsers ignore custom text and show their own dialog */
//             oEvent.preventDefault();

//             oEvent.returnValue = ""; // required by Chrome

//           }

//         }.bind(this);

//         window.addEventListener("beforeunload", this._fnBeforeUnload);

//       },

//       onExit: function () {

//         if (this._fnBeforeUnload) { window.removeEventListener("beforeunload", this._fnBeforeUnload); }

//       },

//       /* ================================================================== */
//       /* SheetJS lazy loader (local lib first, public CDN fallback)          */
//       /* Download once into webapp/lib/xlsx.full.min.js:                     */
//       /*   curl -L -o webapp/lib/xlsx.full.min.js https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js */
//       /* ================================================================== */

//       _ensureXlsx: function () {

//         if (window.XLSX) { return Promise.resolve(window.XLSX); }

//         if (this._xlsxPromise) { return this._xlsxPromise; }

//         var sAppId = (this.getOwnerComponent().getManifestObject().getEntry("/sap.app/id") || "masteruploadbp").replace(/\./g, "/");

//         var aCandidates = [

//           sap.ui.require.toUrl(sAppId + "/lib/xlsx.full.min.js"),

//           "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"

//         ];

//         var loadScript = function (idx) {

//           if (idx >= aCandidates.length) {

//             return Promise.reject(new Error("Excel library (SheetJS) could not be loaded. Place xlsx.full.min.js under webapp/lib/."));

//           }

//           return new Promise(function (resolve, reject) {

//             var s = document.createElement("script");

//             s.src = aCandidates[idx];

//             s.onload = function () { resolve(window.XLSX); };

//             s.onerror = function () { loadScript(idx + 1).then(resolve, reject); };

//             document.head.appendChild(s);

//           });

//         };

//         this._xlsxPromise = loadScript(0);

//         return this._xlsxPromise;

//       },

//       /* ================================================================== */
//       /* 1) DOWNLOAD TEMPLATE  (header "Download Template" button)           */
//       /* ================================================================== */

//       onDownload: function () {

//         this._ensureXlsx().then(function (XLSX) {

//           var wb = XLSX.utils.book_new();

//           /* Template sheet only - headers = ALL MOBI_DB_MASTER fields */

//           var wsTemplate = XLSX.utils.aoa_to_sheet([TEMPLATE_FIELDS.map(function (f) { return f.key; })]);

//           wsTemplate["!cols"] = TEMPLATE_FIELDS.map(function (f) {

//             return { wch: Math.max(f.key.length + 2, 20) };

//           });

//           XLSX.utils.book_append_sheet(wb, wsTemplate, "Master BP Template");

//           XLSX.writeFile(wb, "Master_BP_Upload_Template.xlsx");

//           MessageToast.show("Template downloaded.");

//         }).catch(function (err) {

//           MessageBox.error(err.message);

//         });

//       },

//       /* ================================================================== */
//       /* 2) FILE SELECTED -> parse + validate + preview (change="onUpload")  */
//       /* ================================================================== */

//       onUpload: function (oEvent) {

//         var that = this;

//         var aFiles = oEvent.getParameter("files") || [];

//         var oFile = aFiles[0];

//         if (!oFile) { return; }

//         if (!/\.(xlsx|xls)$/i.test(oFile.name)) {

//           MessageBox.error("Only Excel files (.xlsx / .xls) are supported. Please use the downloaded template.");

//           this._resetUpload();

//           return;

//         }

//         this._fileName = oFile.name;

//         var reader = new FileReader();

//         reader.onload = function (e) {

//           that._ensureXlsx().then(function (XLSX) {

//             var wb = XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: false });

//             var ws = wb.Sheets[wb.SheetNames[0]];

//             var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });

//             that._processSheetAoa(aoa);

//           }).catch(function (err) {

//             MessageBox.error(err.message);

//             that._resetUpload();

//           });

//         };

//         reader.onerror = function () {

//           MessageBox.error("Could not read the selected file.");

//           that._resetUpload();

//         };

//         reader.readAsArrayBuffer(oFile);

//       },

//       _resolveHeaderMapping: function (aHeaderRow) {

//         var map = {}; // columnIndex -> field key

//         aHeaderRow.forEach(function (h, idx) {

//           var sNorm = String(h || "").trim().toLowerCase().replace(/[\s\-]+/g, "_");

//           if (!sNorm) { return; }

//           TEMPLATE_FIELDS.forEach(function (f) {

//             if (f.key === sNorm || f.aliases.indexOf(sNorm) !== -1) { map[idx] = f.key; }

//           });

//         });

//         return map;

//       },

//       _processSheetAoa: function (aoa) {

//         // locate header row (contains at least "id" and "bp_number")

//         var iHeaderIdx = -1;

//         for (var i = 0; i < Math.min(aoa.length, 10); i++) {

//           var oMap = this._resolveHeaderMapping(aoa[i] || []);

//           var aKeys = Object.keys(oMap).map(function (k) { return oMap[k]; });

//           if (aKeys.indexOf("id") !== -1 && aKeys.indexOf("bp_number") !== -1) { iHeaderIdx = i; break; }

//         }

//         if (iHeaderIdx === -1) {

//           MessageBox.error("Header row not found. Please use the downloaded template without renaming headers (id, external_bp_number, bp_number, ...).");

//           this._resetUpload();

//           return;

//         }

//         var oHeaderMap = this._resolveHeaderMapping(aoa[iHeaderIdx]);

//         // every mandatory column must exist

//         var aPresent = Object.keys(oHeaderMap).map(function (k) { return oHeaderMap[k]; });

//         var aMissing = TEMPLATE_FIELDS.filter(function (f) { return f.required && aPresent.indexOf(f.key) === -1; })

//                                       .map(function (f) { return f.key; });

//         if (aMissing.length) {

//           MessageBox.error("Missing mandatory column(s): " + aMissing.join(", ") + ". Please use the downloaded template.");

//           this._resetUpload();

//           return;

//         }

//         // data rows

//         var aRows = [];

//         for (var r = iHeaderIdx + 1; r < aoa.length; r++) {

//           var aLine = aoa[r] || [];

//           var bEmpty = aLine.every(function (v) { return String(v === null || v === undefined ? "" : v).trim() === ""; });

//           if (bEmpty) { continue; }

//           var oRec = {};

//           TEMPLATE_FIELDS.forEach(function (f) { oRec[f.key] = ""; });

//           Object.keys(oHeaderMap).forEach(function (colIdx) {

//             var v = aLine[colIdx];

//             oRec[oHeaderMap[colIdx]] = (v === null || v === undefined) ? "" : String(v).trim();

//           });

//           /* compat: old 1-column template had only "name" = merchant name */

//           if (!oRec.master_name && oRec.name) { oRec.master_name = oRec.name; }

//           oRec._rowNo = r + 1; // excel row number (row 1 = header)

//           aRows.push(oRec);

//         }

//         if (!aRows.length) {

//           MessageBox.error("The file contains only headers without any data records. Please add at least one record and re-upload.");

//           this._resetUpload();

//           return;

//         }

//         this._validateRows(aRows);

//         var iInvalid = aRows.filter(function (r) { return r.rowHighlight === MessageType.Error; }).length;

//         this.getView().getModel("tableModel").setData({ data: aRows });

//         // grow the table to the number of rows so the PAGE scrolls down to see them all
//         this.byId("idTable").setVisibleRowCount(Math.max(15, aRows.length));

//         // green info bar, same text as the GL vlookup app

//         var oSummary = this.byId("recordSummary");

//         oSummary.setText("Total Records uploaded from Excel : " + aRows.length +

//           "   (Valid: " + (aRows.length - iInvalid) + " / Invalid: " + iInvalid + ")");

//         oSummary.setType(iInvalid ? "Warning" : "Success");

//         oSummary.setVisible(true);

//         // enable push only when all rows are Valid

//         // this.byId("btnHanaPush").setEnabled(iInvalid === 0 && aRows.length > 0);
//         // enable push when at least one row is Valid (valid rows go, invalid stay)
//         this.byId("btnHanaPush").setEnabled(aRows.length > iInvalid);
//         if (iInvalid > 0) {

//           MessageBox.warning(iInvalid + " record(s) are invalid (highlighted in red, see Error Detail column). " +

//             "Fix them in the Excel and re-select the file.");

//         }

//       },

//       /* client-side mirror of MasterValidator (+ bp fields mandatory in this app) */

//       _validateRows: function (aRows) {

//         var seenIds = {};

//         aRows.forEach(function (rec) {

//           var aErr = [];

//           var push = function (m) { aErr.push(m); };

//           /* generic: mandatory + max length for every template field */

//           TEMPLATE_FIELDS.forEach(function (f) {

//             var v = (rec[f.key] || "").trim();

//             if (f.required && v === "") {

//               push('Mandatory field "' + f.key + '" is missing or blank.');

//             }

//             if (v !== "" && v.length > f.maxLen) {

//               push('Field "' + f.key + '" exceeds the maximum length of ' + f.maxLen + " characters (received " + v.length + ").");

//             }

//           });

//           // TYPE

//           var sType = rec.type.trim().toLowerCase();

//           if (rec.type.trim() !== "") {

//             if (!VALID_TYPES[sType]) { push('Invalid merchant type "' + rec.type + '". Allowed: Domestic, International, Host.'); }

//             else { rec.type = VALID_TYPES[sType]; }

//           }

//           // Portal

//           var sPortal = rec.mobi_portal_code.trim().toUpperCase();

//           if (sPortal !== "" && VALID_PORTAL_CODES.indexOf(sPortal) === -1) {

//             push('Invalid mobi_portal_code "' + rec.mobi_portal_code + '". Allowed: ' + VALID_PORTAL_CODES.join(", ") + ".");

//           } else { rec.mobi_portal_code = sPortal; }

//           // Company code

//           var sComp = rec.sap_company_code.trim();

//           if (sComp !== "" && (!/^\d+$/.test(sComp) || VALID_COMPANY_CODES.indexOf(sComp) === -1)) {

//             push('Invalid sap_company_code "' + sComp + '". Allowed: ' + VALID_COMPANY_CODES.join(", ") + ".");

//           }

//           // Country code

//           var sCC = rec.country_code.trim().toUpperCase();

//           if (sCC !== "" && (sCC.length !== 2 || VALID_COUNTRY_CODES.indexOf(sCC) === -1)) {

//             push('Invalid country_code "' + rec.country_code + '". Must be a 2-letter ISO country code.');

//           } else { rec.country_code = sCC; }

//           // TIN in exponential notation

//           if (rec.business_reg_no_tin.trim() !== "" && EXPONENTIAL_RE.test(rec.business_reg_no_tin.trim())) {

//             push('business_reg_no_tin "' + rec.business_reg_no_tin + '" must not be in exponential notation.');

//           }

//           // One-character indicator fields: only "X" (or blank) allowed

//           ["check_duplicate_invoice_ind", "gr_based_invoice_ind", "active_flag"].forEach(function (k) {

//             var v = (rec[k] || "").trim().toUpperCase();

//             if (v !== "" && v !== "X") { push('Field "' + k + '" must be "X" or blank.'); }

//             else { rec[k] = v; }

//           });

//           // BP category: 1 (Organization) / 2 (Person)

//           var sCat = (rec.business_partner_category || "").trim();

//           if (sCat !== "" && ["1", "2"].indexOf(sCat) === -1) {

//             push('Invalid business_partner_category "' + sCat + '". Allowed: 1 (Organization), 2 (Person).');

//           } else { rec.business_partner_category = sCat; }

//           // Language: 2-letter key

//           var sLang = (rec.language || "").trim().toUpperCase();

//           if (sLang !== "" && !/^[A-Z]{2}$/.test(sLang)) {

//             push('Invalid language "' + rec.language + '". Use a 2-letter language key (e.g. EN).');

//           } else { rec.language = sLang; }

//           // record_number: whole number when filled (backend overrides it anyway)

//           var sRecNo = (rec.record_number || "").trim();

//           if (sRecNo !== "" && !/^\d+$/.test(sRecNo)) {

//             push('record_number must be a whole number.');

//           }

//           // bp_creation_date: must be a parseable date when filled

//           var sDate = (rec.bp_creation_date || "").trim();

//           if (sDate !== "" && isNaN(new Date(sDate).getTime())) {

//             push('bp_creation_date "' + sDate + '" is not a valid date (use e.g. 2025-08-01).');

//           }

//           // duplicate id within the file (case-insensitive)

//           var sId = rec.id.trim().toUpperCase();

//           if (sId !== "") {

//             if (seenIds[sId]) { push('Duplicate ID "' + rec.id + '" found within the same file.'); }

//             else { seenIds[sId] = true; }

//           }

//           if (aErr.length) {

//             rec.Status = "Invalid";

//             rec.rowHighlight = MessageType.Error;

//             rec.ErrorDetail = aErr.join(" ");

//           } else {

//             rec.Status = "Valid";

//             rec.rowHighlight = MessageType.None;

//             rec.ErrorDetail = "";

//           }

//         });

//       },

//       /* ================================================================== */
//       /* 3) UPLOAD DATA  (btnHanaPush)  ->  POST to CAP service              */
//       /* ================================================================== */

//       _serviceBase: function () {

//         /* NEVER trust a broken manifest uri (e.g. //srv-api/... -> cross-origin -> "Failed to fetch").
//            Only a plain same-origin relative path pointing at master-upload is accepted. */
//         var sUri = "/odata/v4/master-upload/";
//         try {
//           var sCfg = this.getOwnerComponent().getManifestObject().getEntry("/sap.app/dataSources/mainService/uri");
//           var bValid = sCfg && sCfg.charAt(0) === "/" && sCfg.charAt(1) !== "/" &&
//                        sCfg.indexOf("://") === -1 && sCfg.indexOf("master-upload") !== -1;
//           if (bValid) { sUri = sCfg; }
//         } catch (e) { /* keep default */ }

//         return sUri.charAt(sUri.length - 1) === "/" ? sUri : sUri + "/";

//       },

//       _fetchCsrfToken: function () {

//         var that = this;

//         return fetch(this._serviceBase(), { method: "GET", headers: { "X-CSRF-Token": "Fetch" }, credentials: "same-origin" })

//           .then(function (resp) {

//             that._csrfToken = resp.headers.get("X-CSRF-Token") || "";

//             return that._csrfToken;

//           })

//           .catch(function () { that._csrfToken = ""; return ""; });

//       },

//       _postAction: function (payload, bRetried) {

//         var that = this;

//         var oHeaders = { "Content-Type": "application/json" };

//         if (this._csrfToken) { oHeaders["X-CSRF-Token"] = this._csrfToken; }

//         return fetch(this._serviceBase() + "uploadMasterRecords", {

//           method: "POST",

//           headers: oHeaders,

//           credentials: "same-origin",

//           body: JSON.stringify(payload)

//         }).then(function (resp) {

//           if (resp.status === 403 && !bRetried) {

//             return that._fetchCsrfToken().then(function () { return that._postAction(payload, true); });

//           }

//           /* read as text first so HTML error pages give a friendly message */

//           return resp.text().then(function (sBody) {

//             var oJson = null;

//             try { oJson = sBody ? JSON.parse(sBody) : null; }

//             catch (e) {

//               throw new Error("HTTP " + resp.status + " - the server did not return JSON. " +

//                 "Check that /odata/v4/master-upload is served by your cds watch (no startup errors).");

//             }

//             if (!resp.ok) { throw new Error((oJson && oJson.error && oJson.error.message) || ("HTTP " + resp.status)); }

//             return (oJson && oJson.value) ? (oJson.value[0] || oJson.value) : oJson;

//           });

//         });

//       },

//       // onhanapush: function () {

//       //   var that = this;

//       //   var oModel = this.getView().getModel("tableModel");

//       //   var aRows = oModel.getProperty("/data") || [];

//       //   if (!aRows.length) {

//       //     MessageBox.warning("Please select and review an Excel file first.");

//       //     return;

//       //   }

//       //   var aInvalid = aRows.filter(function (r) { return r.rowHighlight === MessageType.Error; });

//       //   if (aInvalid.length) {

//       //     MessageBox.error(aInvalid.length + " record(s) are invalid. Fix them in the Excel and re-upload.");

//       //     return;

//       //   }

//       //   /* send ALL template fields (uppercase DB names) - backend decides  */
//       //   /* which ones to use / derive / override                            */

//       //   var aPayload = aRows.map(function (r) {

//       //     var oRec = {};

//       //     TEMPLATE_FIELDS.forEach(function (f) {

//       //       var v = r[f.key];

//       //       oRec[f.key.toUpperCase()] = (v === undefined || v === null) ? "" : String(v).trim();

//       //     });

//       //     return oRec;

//       //   });

//       //   this.getView().setBusy(true);

//       //   this.byId("btnHanaPush").setEnabled(false);

//       //   this._fetchCsrfToken()

//       //     .then(function () { return that._postAction({ fileName: that._fileName || "Master_BP_Upload.xlsx", records: aPayload }); })

//       //     .then(function (oResult) {

//       //       oResult = oResult || {};

//       //       var aSrvErrors = oResult.errors || [];

//       //       var oStrip = that.byId("uploadSummary");

//       //       oStrip.setVisible(true);

//       //       if (aSrvErrors.length) {

//       //         // mark rows rejected by backend (e.g. duplicates in MOBI_DB_MASTER)

//       //         var oErrByRow = {};

//       //         aSrvErrors.forEach(function (e) { oErrByRow[Number(e.rowNo)] = e; });

//       //         aRows.forEach(function (rec) {

//       //           var e = oErrByRow[Number(rec._rowNo)];

//       //           if (e) {

//       //             rec.Status = "Invalid";

//       //             rec.rowHighlight = MessageType.Error;

//       //             rec.ErrorDetail = e.errorDetail || "Rejected by server.";

//       //           }

//       //         });

//       //         oModel.refresh(true);

//       //         oStrip.setType("Warning");

//       //         oStrip.setText((oResult.inserted || 0) + " record(s) inserted. " + aSrvErrors.length +

//       //           " rejected (duplicates/validation) - see Error Detail column.");

//       //         MessageBox.warning((oResult.inserted || 0) + " record(s) inserted into MOBI_DB_MASTER (STATUS 063).\n\n" +

//       //           aSrvErrors.length + " record(s) rejected - see the Error Detail column in the table.");

//       //       } else {

//       //         MessageToast.show("Excel uploaded successfully.");

//       //         oStrip.setType("Success");

//       //         oStrip.setText(oResult.message || ((oResult.inserted || aRows.length) +

//       //           " record(s) inserted into MOBI_DB_MASTER with STATUS_CODE 063 (BP_CREATED_SUCCESS). CPI will not recreate these BPs."));

//       //         that._resetUpload(true);

//       //       }

//       //     })

//       //     .catch(function (err) {

//       //       MessageBox.error("Upload failed: " + err.message);

//       //       that.byId("btnHanaPush").setEnabled(true);

//       //     })

//       //     .finally(function () {

//       //       that.getView().setBusy(false);

//       //     });

//       // },

//       /* ================================================================== */
//       /* helpers                                                             */
//       /* ================================================================== */
//       onhanapush: function () {

//         var that = this;

//         var oModel = this.getView().getModel("tableModel");

//         var aRows = oModel.getProperty("/data") || [];


//         if (!aRows.length) {

//           MessageBox.warning("Please select and review an Excel file first.");

//           return;

//         }


//         /* partial upload: send only Valid rows; Invalid rows stay in the table (red) */

//         var aValid = aRows.filter(function (r) { return r.rowHighlight !== MessageType.Error; });

//         var iSkipped = aRows.length - aValid.length;

//         if (!aValid.length) {

//           MessageBox.error("All records are invalid. Fix them in the Excel and re-upload.");

//           return;

//         }


//         var aPayload = aValid.map(function (r) {

//           var oRec = {};

//           TEMPLATE_FIELDS.forEach(function (f) {

//             var v = r[f.key];

//             oRec[f.key.toUpperCase()] = (v === undefined || v === null) ? "" : String(v).trim();

//           });

//           oRec.ROW_NO = Number(r._rowNo) || 0; // original Excel row -> accurate server error mapping

//           return oRec;

//         });


//         this.getView().setBusy(true);

//         this.byId("btnHanaPush").setEnabled(false);


//         this._fetchCsrfToken()

//           .then(function () { return that._postAction({ fileName: that._fileName || "Master_BP_Upload.xlsx", records: aPayload }); })

//           .then(function (oResult) {

//             oResult = oResult || {};

//             var aSrvErrors = oResult.errors || [];


//             var oStrip = that.byId("uploadSummary");

//             oStrip.setVisible(true);


//             /* mark rows rejected by backend (duplicates / validation) */

//             var oErrByRow = {};

//             aSrvErrors.forEach(function (e) { oErrByRow[Number(e.rowNo)] = e; });


//             aRows.forEach(function (rec) {

//               var e = oErrByRow[Number(rec._rowNo)];

//               if (e) {

//                 rec.Status = "Invalid";

//                 rec.rowHighlight = MessageType.Error;

//                 rec.ErrorDetail = e.errorDetail || "Rejected by server.";

//               }

//             });


//             /* inserted rows leave the table; rejected + skipped rows stay for fixing */

//             var iInserted = oResult.inserted || 0;

//             var aRemain = aRows.filter(function (rec) { return rec.rowHighlight === MessageType.Error; });

//             oModel.setData({ data: aRemain });


//             var sText = iInserted + " record(s) inserted into MOBI_DB_MASTER (STATUS 063)." +

//               (aSrvErrors.length ? " " + aSrvErrors.length + " rejected by server (see Error Detail)." : "") +

//               (iSkipped ? " " + iSkipped + " skipped (invalid rows, still red above)." : "");


//             oStrip.setType((aSrvErrors.length || iSkipped) ? "Warning" : "Success");

//             oStrip.setText(sText);


//             that.byId("btnHanaPush").setEnabled(aRemain.some(function (rec) { return rec.rowHighlight !== MessageType.Error; }));


//             if (!aRemain.length) {

//               MessageToast.show("Excel uploaded successfully.");

//               that._resetUpload(true);

//             } else {

//               MessageBox.warning(sText + "\n\nFix the remaining rows in the Excel and upload again.");

//             }

//           })

//           .catch(function (err) {

//             MessageBox.error("Upload failed: " + err.message);

//             that.byId("btnHanaPush").setEnabled(true);

//           })

//           .finally(function () {

//             that.getView().setBusy(false);

//           });

//       },
//       _resetUpload: function (bKeepResultStrip) {

//         this.getView().getModel("tableModel").setData({ data: [] });

//         // shrink the table back so the page does not keep a huge empty area
//         var oTable = this.byId("idTable");
//         if (oTable) { oTable.setVisibleRowCount(15); }

//         var oUploader = this.byId("fileUploader");

//         if (oUploader) { oUploader.clear(); }

//         this.byId("btnHanaPush").setEnabled(false);

//         this.byId("recordSummary").setVisible(false);

//         if (!bKeepResultStrip) {

//           this.byId("uploadSummary").setVisible(false);

//         }

//         this._fileName = null;

//       },

//       onHelp: function () {

//         MessageBox.information(

//           "1. Click 'Download Template' to get the Excel with ALL MOBI_DB_MASTER columns.\n" +

//           "2. Mandatory: id, mobi_portal_code, sap_company_code, type, master_name, country_code, external_bp_number, bp_number (BP already created in Public Cloud).\n" +

//           "3. Optional columns left blank are derived by the backend (e.g. name <- master_name, street <- address1, country_region <- country_code, language <- EN, sales/purchasing org <- company code).\n" +

//           "4. audit_id, status_code, file_id, file_name, record_number are always assigned by the backend; status_code is forced to 063 (BP_CREATED_SUCCESS) so CPI skips these BPs.\n" +

//           "5. Rows already existing in MOBI_DB_MASTER are rejected as duplicates."

//         );

//       }

//     });

//   }

// );

// -------------------------------------------------------

sap.ui.define(

  [

    "sap/ui/core/mvc/Controller",

    "sap/ui/model/json/JSONModel",

    "sap/ui/core/MessageType",

    "sap/m/MessageToast",

    "sap/m/MessageBox"

  ],

  function (Controller, JSONModel, MessageType, MessageToast, MessageBox) {

    "use strict";

    /* ================================================================== */
    /* Template field definitions - user-facing MOBI_DB_MASTER fields       */
    /* (template columns appear in exactly this DB order)                  */
    /* required : validated as mandatory by MasterValidator / this app     */
    /* REMOVED from template + UI on request (backend still assigns/       */
    /* derives them in the DB, functionality unchanged):                   */
    /*   audit_id, grouping, language, reconciliation_account,             */
    /*   check_duplicate_invoice_ind, gr_based_invoice_ind,                */
    /*   business_partner_category, business_partner_role,                 */
    /*   active_flag, status_code, record_number                           */
    /* ================================================================== */

    var TEMPLATE_FIELDS = [

      /* ---- core fields ---- */
      { key: "id",                          aliases: ["id", "merchant_id"],                        required: true,  maxLen: 20,  sample: "MCHT00012345" },
      { key: "mobi_portal_code",            aliases: ["mobi_portal_code", "portal_code"],          required: true,  maxLen: 2,   sample: "MY" },
      { key: "sap_company_code",            aliases: ["sap_company_code", "company_code"],         required: true,  maxLen: 4,   sample: "2000" },
      { key: "type",                        aliases: ["type", "merchant_type"],                    required: true,  maxLen: 20,  sample: "Domestic" },
      { key: "address1",                    aliases: ["address1", "address"],                      required: false, maxLen: 255, sample: "LOT 10, JALAN BUKIT" },
      { key: "postal_code",                 aliases: ["postal_code", "zip"],                       required: false, maxLen: 10,  sample: "50450" },
      { key: "country",                     aliases: ["country", "country_name"],                  required: false, maxLen: 80,  sample: "Malaysia" },
      { key: "country_code",                aliases: ["country_code", "country_code_in_sap"],      required: true,  maxLen: 2,   sample: "MY" },
      { key: "business_reg_no_tin",         aliases: ["business_reg_no_tin", "tin"],               required: false, maxLen: 50,  sample: "123456789012345" },
      { key: "master_name",                 aliases: ["master_name", "merchant_name"],             required: true,  maxLen: 40,  sample: "ABC RETAIL SDN BHD" },
      { key: "external_bp_number",          aliases: ["external_bp_number", "external_bp"],        required: true,  maxLen: 20,  sample: "MCHT00012345" },
      { key: "bp_number",                   aliases: ["bp_number", "bp", "sap_bp_number"],         required: true,  maxLen: 10,  sample: "10004567" },

      /* ---- optional master fields: filled = used as entered, blank = derived ---- */
      { key: "name",                        aliases: ["name", "bp_name"],                          required: false, maxLen: 40,  sample: "blank = master_name" },
      { key: "street",                      aliases: ["street"],                                   required: false, maxLen: 60,  sample: "blank = address1" },
      { key: "country_region",              aliases: ["country_region", "region"],                 required: false, maxLen: 10,  sample: "blank = country_code" },
      { key: "bp_tax_long_number",          aliases: ["bp_tax_long_number", "tax_number"],         required: false, maxLen: 50,  sample: "blank = business_reg_no_tin" },
      { key: "purchasing_organization",     aliases: ["purchasing_organization", "purchase_org", "purch_org"], required: false, maxLen: 4, sample: "blank = company code" },
      { key: "sales_organization",          aliases: ["sales_organization", "sales_org"],          required: false, maxLen: 4,   sample: "blank = company code" },

      /* ---- system field accepted in the sheet; free-text date (blank = now) ---- */
      { key: "bp_creation_date",            aliases: ["bp_creation_date"],                         required: false, maxLen: 50,  sample: "blank = now (e.g. 2025-08-01)" }

      /* audit_id, status_code, record_number, file_id, file_name, host_name,
         grouping, language, reconciliation_account, the indicators, BP category/role
         and active_flag are NOT in the template/table by design -
         the backend always assigns or derives them */

    ];

    var VALID_PORTAL_CODES  = ["SG", "MY", "IN", "ID", "AE"];

    var VALID_COMPANY_CODES = ["1000", "2000", "3000", "4000", "5000"];

    var VALID_TYPES         = { domestic: "Domestic", international: "International", host: "Host" };

    /* ISO 3166-1 alpha-2 (same as Constants.VALID_COUNTRY_CODES) */

    var VALID_COUNTRY_CODES = ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
      "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
      "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
      "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
      "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
      "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
      "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW").split(" ");

    var EXPONENTIAL_RE = /^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/;

    return Controller.extend("masterbpupload.controller.View1", {

      onInit: function () {

        this.getView().setModel(new JSONModel({ data: [] }), "tableModel");

        this._csrfToken = null;

        /* ---- the PAGE scrolls vertically; the TABLE scrolls horizontally ---- */
        var oTable = this.byId("idTable");
        if (oTable) {
          // (a) Stop columns from shrinking to fit the screen -> HORIZONTAL scrollbar (on the table)
          oTable.getColumns().forEach(function (oCol) {
            var iW = parseInt(oCol.getWidth(), 10);
            if (!isNaN(iW)) { oCol.setMinWidth(iW); }
          });
          // (b) Fixed mode; the row count is set to the data length in onUpload,
          //     so the table grows and the PAGE scrolls down to show all rows.
          oTable.setVisibleRowCountMode(sap.ui.table.VisibleRowCountMode.Fixed);
          oTable.setVisibleRowCount(15);
        }

        /* "Leave site?" warning on browser Back / tab close while records are loaded */
        this._fnBeforeUnload = function (oEvent) {

          var aRows = (this.getView().getModel("tableModel").getProperty("/data")) || [];

          if (aRows.length) {

            /* modern browsers ignore custom text and show their own dialog */
            oEvent.preventDefault();

            oEvent.returnValue = ""; // required by Chrome

          }

        }.bind(this);

        window.addEventListener("beforeunload", this._fnBeforeUnload);

      },

      onExit: function () {

        if (this._fnBeforeUnload) { window.removeEventListener("beforeunload", this._fnBeforeUnload); }

      },

      /* ================================================================== */
      /* SheetJS lazy loader (local lib first, public CDN fallback)          */
      /* ================================================================== */

      _ensureXlsx: function () {

        if (window.XLSX) { return Promise.resolve(window.XLSX); }

        if (this._xlsxPromise) { return this._xlsxPromise; }

        var sAppId = (this.getOwnerComponent().getManifestObject().getEntry("/sap.app/id") || "masterbpupload").replace(/\./g, "/");

        var aCandidates = [

          sap.ui.require.toUrl(sAppId + "/lib/xlsx.full.min.js"),

          "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"

        ];

        var loadScript = function (idx) {

          if (idx >= aCandidates.length) {

            return Promise.reject(new Error("Excel library (SheetJS) could not be loaded. Place xlsx.full.min.js under webapp/lib/."));

          }

          return new Promise(function (resolve, reject) {

            var s = document.createElement("script");

            s.src = aCandidates[idx];

            s.onload = function () { resolve(window.XLSX); };

            s.onerror = function () { loadScript(idx + 1).then(resolve, reject); };

            document.head.appendChild(s);

          });

        };

        this._xlsxPromise = loadScript(0);

        return this._xlsxPromise;

      },

      /* ================================================================== */
      /* 1) DOWNLOAD TEMPLATE                                                */
      /* ================================================================== */

      onDownload: function () {

        this._ensureXlsx().then(function (XLSX) {

          var wb = XLSX.utils.book_new();

          /* Template sheet only - headers = user-facing template fields */

          var wsTemplate = XLSX.utils.aoa_to_sheet([TEMPLATE_FIELDS.map(function (f) { return f.key; })]);

          wsTemplate["!cols"] = TEMPLATE_FIELDS.map(function (f) {

            return { wch: Math.max(f.key.length + 2, 20) };

          });

          XLSX.utils.book_append_sheet(wb, wsTemplate, "Master BP Template");

          XLSX.writeFile(wb, "Master_BP_Upload_Template.xlsx");

          MessageToast.show("Template downloaded.");

        }).catch(function (err) {

          MessageBox.error(err.message);

        });

      },

      /* ================================================================== */
      /* 2) FILE SELECTED -> parse + validate + preview                      */
      /* ================================================================== */

      onUpload: function (oEvent) {

        var that = this;

        var aFiles = oEvent.getParameter("files") || [];

        var oFile = aFiles[0];

        if (!oFile) { return; }

        if (!/\.(xlsx|xls)$/i.test(oFile.name)) {

          MessageBox.error("Only Excel files (.xlsx / .xls) are supported. Please use the downloaded template.");

          this._resetUpload();

          return;

        }

        this._fileName = oFile.name;

        var reader = new FileReader();

        reader.onload = function (e) {

          that._ensureXlsx().then(function (XLSX) {

            var wb = XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: false });

            var ws = wb.Sheets[wb.SheetNames[0]];

            var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });

            that._processSheetAoa(aoa);

          }).catch(function (err) {

            MessageBox.error(err.message);

            that._resetUpload();

          });

        };

        reader.onerror = function () {

          MessageBox.error("Could not read the selected file.");

          that._resetUpload();

        };

        reader.readAsArrayBuffer(oFile);

      },

      _resolveHeaderMapping: function (aHeaderRow) {

        var map = {}; // columnIndex -> field key

        aHeaderRow.forEach(function (h, idx) {

          var sNorm = String(h || "").trim().toLowerCase().replace(/[\s\-]+/g, "_");

          if (!sNorm) { return; }

          TEMPLATE_FIELDS.forEach(function (f) {

            if (f.key === sNorm || f.aliases.indexOf(sNorm) !== -1) { map[idx] = f.key; }

          });

        });

        return map;

      },

      _processSheetAoa: function (aoa) {

        // locate header row (contains at least "id" and "bp_number")

        var iHeaderIdx = -1;

        for (var i = 0; i < Math.min(aoa.length, 10); i++) {

          var oMap = this._resolveHeaderMapping(aoa[i] || []);

          var aKeys = Object.keys(oMap).map(function (k) { return oMap[k]; });

          if (aKeys.indexOf("id") !== -1 && aKeys.indexOf("bp_number") !== -1) { iHeaderIdx = i; break; }

        }

        if (iHeaderIdx === -1) {

          MessageBox.error("Header row not found. Please use the downloaded template without renaming headers (id, external_bp_number, bp_number, ...).");

          this._resetUpload();

          return;

        }

        var oHeaderMap = this._resolveHeaderMapping(aoa[iHeaderIdx]);

        // every mandatory column must exist

        var aPresent = Object.keys(oHeaderMap).map(function (k) { return oHeaderMap[k]; });

        var aMissing = TEMPLATE_FIELDS.filter(function (f) { return f.required && aPresent.indexOf(f.key) === -1; })

                                      .map(function (f) { return f.key; });

        if (aMissing.length) {

          MessageBox.error("Missing mandatory column(s): " + aMissing.join(", ") + ". Please use the downloaded template.");

          this._resetUpload();

          return;

        }

        // data rows

        var aRows = [];

        for (var r = iHeaderIdx + 1; r < aoa.length; r++) {

          var aLine = aoa[r] || [];

          var bEmpty = aLine.every(function (v) { return String(v === null || v === undefined ? "" : v).trim() === ""; });

          if (bEmpty) { continue; }

          var oRec = {};

          TEMPLATE_FIELDS.forEach(function (f) { oRec[f.key] = ""; });

          Object.keys(oHeaderMap).forEach(function (colIdx) {

            var v = aLine[colIdx];

            oRec[oHeaderMap[colIdx]] = (v === null || v === undefined) ? "" : String(v).trim();

          });

          /* compat: old 1-column template had only "name" = merchant name */

          if (!oRec.master_name && oRec.name) { oRec.master_name = oRec.name; }

          oRec._rowNo = r + 1; // excel row number (row 1 = header)

          aRows.push(oRec);

        }

        if (!aRows.length) {

          MessageBox.error("The file contains only headers without any data records. Please add at least one record and re-upload.");

          this._resetUpload();

          return;

        }

        this._validateRows(aRows);

        var iInvalid = aRows.filter(function (r) { return r.rowHighlight === MessageType.Error; }).length;

        this.getView().getModel("tableModel").setData({ data: aRows });

        // grow the table to the number of rows so the PAGE scrolls down to see them all
        this.byId("idTable").setVisibleRowCount(Math.max(15, aRows.length));

        // green info bar, same text as the GL vlookup app

        var oSummary = this.byId("recordSummary");

        oSummary.setText("Total Records uploaded from Excel : " + aRows.length +

          "   (Valid: " + (aRows.length - iInvalid) + " / Invalid: " + iInvalid + ")");

        oSummary.setType(iInvalid ? "Warning" : "Success");

        oSummary.setVisible(true);

        // enable push when at least one row is Valid (valid rows go, invalid stay)
        this.byId("btnHanaPush").setEnabled(aRows.length > iInvalid);
        if (iInvalid > 0) {

          MessageBox.warning(iInvalid + " record(s) are invalid (highlighted in red, see Error Detail column). " +

            "Fix them in the Excel and re-select the file.");

        }

      },

      /* client-side mirror of MasterValidator (+ bp fields mandatory in this app) */

      _validateRows: function (aRows) {

        var seenIds = {};

        aRows.forEach(function (rec) {

          var aErr = [];

          var push = function (m) { aErr.push(m); };

          /* generic: mandatory + max length for every template field */

          TEMPLATE_FIELDS.forEach(function (f) {

            var v = (rec[f.key] || "").trim();

            if (f.required && v === "") {

              push('Mandatory field "' + f.key + '" is missing or blank.');

            }

            if (v !== "" && v.length > f.maxLen) {

              push('Field "' + f.key + '" exceeds the maximum length of ' + f.maxLen + " characters (received " + v.length + ").");

            }

          });

          // TYPE

          var sType = rec.type.trim().toLowerCase();

          if (rec.type.trim() !== "") {

            if (!VALID_TYPES[sType]) { push('Invalid merchant type "' + rec.type + '". Allowed: Domestic, International, Host.'); }

            else { rec.type = VALID_TYPES[sType]; }

          }

          // Portal

          var sPortal = rec.mobi_portal_code.trim().toUpperCase();

          if (sPortal !== "" && VALID_PORTAL_CODES.indexOf(sPortal) === -1) {

            push('Invalid mobi_portal_code "' + rec.mobi_portal_code + '". Allowed: ' + VALID_PORTAL_CODES.join(", ") + ".");

          } else { rec.mobi_portal_code = sPortal; }

          // Company code

          var sComp = rec.sap_company_code.trim();

          if (sComp !== "" && (!/^\d+$/.test(sComp) || VALID_COMPANY_CODES.indexOf(sComp) === -1)) {

            push('Invalid sap_company_code "' + sComp + '". Allowed: ' + VALID_COMPANY_CODES.join(", ") + ".");

          }

          // Country code

          var sCC = rec.country_code.trim().toUpperCase();

          if (sCC !== "" && (sCC.length !== 2 || VALID_COUNTRY_CODES.indexOf(sCC) === -1)) {

            push('Invalid country_code "' + rec.country_code + '". Must be a 2-letter ISO country code.');

          } else { rec.country_code = sCC; }

          // TIN in exponential notation

          if (rec.business_reg_no_tin.trim() !== "" && EXPONENTIAL_RE.test(rec.business_reg_no_tin.trim())) {

            push('business_reg_no_tin "' + rec.business_reg_no_tin + '" must not be in exponential notation.');

          }

          // bp_creation_date: must be a parseable date when filled

          var sDate = (rec.bp_creation_date || "").trim();

          if (sDate !== "" && isNaN(new Date(sDate).getTime())) {

            push('bp_creation_date "' + sDate + '" is not a valid date (use e.g. 2025-08-01).');

          }

          // duplicate id within the file (case-insensitive)

          var sId = rec.id.trim().toUpperCase();

          if (sId !== "") {

            if (seenIds[sId]) { push('Duplicate ID "' + rec.id + '" found within the same file.'); }

            else { seenIds[sId] = true; }

          }

          if (aErr.length) {

            rec.Status = "Invalid";

            rec.rowHighlight = MessageType.Error;

            rec.ErrorDetail = aErr.join(" ");

          } else {

            rec.Status = "Valid";

            rec.rowHighlight = MessageType.None;

            rec.ErrorDetail = "";

          }

        });

      },

      /* ================================================================== */
      /* 3) UPLOAD DATA  (btnHanaPush)  ->  POST to CAP service              */
      /* ================================================================== */

      _serviceBase: function () {

        /* NEVER trust a broken manifest uri (e.g. //srv-api/... -> cross-origin -> "Failed to fetch").
           Only a plain same-origin relative path pointing at master-upload is accepted. */
        var sUri = "/odata/v4/master-upload/";
        try {
          var sCfg = this.getOwnerComponent().getManifestObject().getEntry("/sap.app/dataSources/mainService/uri");
          var bValid = sCfg && sCfg.charAt(0) === "/" && sCfg.charAt(1) !== "/" &&
                       sCfg.indexOf("://") === -1 && sCfg.indexOf("master-upload") !== -1;
          if (bValid) { sUri = sCfg; }
        } catch (e) { /* keep default */ }

        return sUri.charAt(sUri.length - 1) === "/" ? sUri : sUri + "/";

      },

      _fetchCsrfToken: function () {

        var that = this;

        return fetch(this._serviceBase(), { method: "GET", headers: { "X-CSRF-Token": "Fetch" }, credentials: "same-origin" })

          .then(function (resp) {

            that._csrfToken = resp.headers.get("X-CSRF-Token") || "";

            return that._csrfToken;

          })

          .catch(function () { that._csrfToken = ""; return ""; });

      },

      _postAction: function (payload, bRetried) {

        var that = this;

        var oHeaders = { "Content-Type": "application/json" };

        if (this._csrfToken) { oHeaders["X-CSRF-Token"] = this._csrfToken; }

        return fetch(this._serviceBase() + "uploadMasterRecords", {

          method: "POST",

          headers: oHeaders,

          credentials: "same-origin",

          body: JSON.stringify(payload)

        }).then(function (resp) {

          if (resp.status === 403 && !bRetried) {

            return that._fetchCsrfToken().then(function () { return that._postAction(payload, true); });

          }

          /* read as text first so HTML error pages give a friendly message */

          return resp.text().then(function (sBody) {

            var oJson = null;

            try { oJson = sBody ? JSON.parse(sBody) : null; }

            catch (e) {

              throw new Error("HTTP " + resp.status + " - the server did not return JSON. " +

                "Check that /odata/v4/master-upload is served by your cds watch (no startup errors).");

            }

            if (!resp.ok) { throw new Error((oJson && oJson.error && oJson.error.message) || ("HTTP " + resp.status)); }

            return (oJson && oJson.value) ? (oJson.value[0] || oJson.value) : oJson;

          });

        });

      },

      /* partial upload: send only Valid rows; Invalid rows stay in the table (red) */

      onhanapush: function () {

        var that = this;

        var oModel = this.getView().getModel("tableModel");

        var aRows = oModel.getProperty("/data") || [];

        if (!aRows.length) {

          MessageBox.warning("Please select and review an Excel file first.");

          return;

        }

        var aValid = aRows.filter(function (r) { return r.rowHighlight !== MessageType.Error; });

        var iSkipped = aRows.length - aValid.length;

        if (!aValid.length) {

          MessageBox.error("All records are invalid. Fix them in the Excel and re-upload.");

          return;

        }

        /* payload = the template fields (uppercase DB names) + ROW_NO;      */
        /* removed/system fields are simply not sent - the backend assigns    */
        /* or derives them exactly like before                                */

        var aPayload = aValid.map(function (r) {

          var oRec = {};

          TEMPLATE_FIELDS.forEach(function (f) {

            var v = r[f.key];

            oRec[f.key.toUpperCase()] = (v === undefined || v === null) ? "" : String(v).trim();

          });

          oRec.ROW_NO = Number(r._rowNo) || 0; // original Excel row -> accurate server error mapping

          return oRec;

        });

        this.getView().setBusy(true);

        this.byId("btnHanaPush").setEnabled(false);

        this._fetchCsrfToken()

          .then(function () { return that._postAction({ fileName: that._fileName || "Master_BP_Upload.xlsx", records: aPayload }); })

          .then(function (oResult) {

            oResult = oResult || {};

            var aSrvErrors = oResult.errors || [];

            var oStrip = that.byId("uploadSummary");

            oStrip.setVisible(true);

            /* mark rows rejected by backend (duplicates / validation) */

            var oErrByRow = {};

            aSrvErrors.forEach(function (e) { oErrByRow[Number(e.rowNo)] = e; });

            aRows.forEach(function (rec) {

              var e = oErrByRow[Number(rec._rowNo)];

              if (e) {

                rec.Status = "Invalid";

                rec.rowHighlight = MessageType.Error;

                rec.ErrorDetail = e.errorDetail || "Rejected by server.";

              }

            });

            /* inserted rows leave the table; rejected + skipped rows stay for fixing */

            var iInserted = oResult.inserted || 0;

            var aRemain = aRows.filter(function (rec) { return rec.rowHighlight === MessageType.Error; });

            oModel.setData({ data: aRemain });

            var sText = iInserted + " record(s) inserted into MOBI_DB_MASTER (STATUS 063)." +

              (aSrvErrors.length ? " " + aSrvErrors.length + " rejected by server (see Error Detail)." : "") +

              (iSkipped ? " " + iSkipped + " skipped (invalid rows, still red above)." : "");

            oStrip.setType((aSrvErrors.length || iSkipped) ? "Warning" : "Success");

            oStrip.setText(sText);

            that.byId("btnHanaPush").setEnabled(aRemain.some(function (rec) { return rec.rowHighlight !== MessageType.Error; }));

            if (!aRemain.length) {

              MessageToast.show("Excel uploaded successfully.");

              that._resetUpload(true);

            } else {

              MessageBox.warning(sText + "\n\nFix the remaining rows in the Excel and upload again.");

            }

          })

          .catch(function (err) {

            MessageBox.error("Upload failed: " + err.message);

            that.byId("btnHanaPush").setEnabled(true);

          })

          .finally(function () {

            that.getView().setBusy(false);

          });

      },

      /* ================================================================== */
      /* helpers                                                             */
      /* ================================================================== */

      _resetUpload: function (bKeepResultStrip) {

        this.getView().getModel("tableModel").setData({ data: [] });

        // shrink the table back so the page does not keep a huge empty area
        var oTable = this.byId("idTable");
        if (oTable) { oTable.setVisibleRowCount(15); }

        var oUploader = this.byId("fileUploader");

        if (oUploader) { oUploader.clear(); }

        this.byId("btnHanaPush").setEnabled(false);

        this.byId("recordSummary").setVisible(false);

        if (!bKeepResultStrip) {

          this.byId("uploadSummary").setVisible(false);

        }

        this._fileName = null;

      },

      onHelp: function () {

        MessageBox.information(

          "1. Click 'Download Template' to get the Excel with the Master BP columns.\n" +

          "2. Mandatory: id, mobi_portal_code, sap_company_code, type, master_name, country_code, external_bp_number, bp_number (BP already created in Public Cloud).\n" +

          "3. Optional columns left blank are derived by the backend (e.g. name <- master_name, street <- address1, country_region <- country_code, sales/purchasing org <- company code).\n" +

          "4. System fields (audit_id, status_code, record_number, active_flag, language, grouping, BP role/category, invoice indicators, recon account) are NOT in the template - the backend assigns or derives them; status_code is always 063 (BP_CREATED_SUCCESS) so CPI skips these BPs.\n" +

          "5. Rows already existing in MOBI_DB_MASTER are rejected as duplicates."

        );

      }

    });

  }

);
