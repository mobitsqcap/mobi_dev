"use strict";

sap.ui.define(["sap/base/Log", "sap/ui/model/odata/v2/ODataModel"], function (log, ODataModel) {
  "use strict";

  /**
   * Returns the base URL for API requests.
   *
   * @returns Base URL string
   */
  function getBaseUrl() {
    return document.getElementById('root')?.dataset.openUxPreviewBaseUrl ?? '';
  }

  /**
   * Creates a UI5 ODataModel with annotation URLs and returns its metamodel
   * with entity containers, schema, and model information.
   *
   * @param serviceInfo Service URL and annotation details from the server
   * @returns Promise resolving to a metamodel object
   */
  async function buildMetaModel(serviceInfo) {
    const annotationUris = serviceInfo.annotations.map(a => a.Uri);
    const model = new ODataModel(serviceInfo.serviceUrl, {
      annotationURI: annotationUris,
      loadAnnotationsJoined: true,
      skipMetadataAnnotationParsing: false,
      json: true
    });
    const metaModel = model.getMetaModel();
    await metaModel.loaded();
    return {
      oEntityContainers: metaModel.getODataEntityContainer(),
      oSchema: metaModel.getObject('/dataServices/schema'),
      modelInformation: serviceInfo.modelInformation
    };
  }

  /**
   * Writes i18n entries to the adaptation project's i18n properties file.
   * Fire-and-forget: the OVP runtime does not await the result.
   *
   * @param _path - i18n path (ignored; server resolves from project context)
   * @param properties - Array of i18n key-value entries to write
   */
  function writeToI18n(_path, properties) {
    const entries = properties.map(p => ({
      key: p.key,
      value: p.value,
      annotation: p.textType
    }));
    fetch(`${getBaseUrl()}/editor/i18n`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(entries)
    }).catch(error => {
      log.error('OVP writeToI18n failed', error);
    });
  }

  /**
   * Fetches available OData V2 services from the ABAP system catalog.
   *
   * @param _path - Application path (ignored; server uses its own provider)
   * @returns Promise resolving to an object with a results array of service metadata
   */
  async function getNewDataSources(_path) {
    const response = await fetch(`${getBaseUrl()}/adp/api/ovp/datasources`);
    if (!response.ok) {
      throw new Error(`Failed to fetch data sources: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Fetches the OData metadata model for a selected data source service.
   * Creates a real UI5 ODataModel with annotations to build a full metamodel
   * compatible with the OVP dialog.
   *
   * @param selectedDataSources - Array of selected data source objects
   * @param _path - Application path (ignored; server uses its own provider)
   * @returns Promise resolving to a metamodel object
   */
  async function getMetaModelForNewDataSource(selectedDataSources, _path) {
    const response = await fetch(`${getBaseUrl()}/adp/api/ovp/metamodel`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        dataSource: selectedDataSources[0]
      })
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch metamodel: ${response.status}`);
    }
    const serviceInfo = await response.json();
    if (!serviceInfo) {
      return undefined;
    }
    return buildMetaModel(serviceInfo);
  }

  /**
   * Initializes OVP bridge functions required by the sap.ovp library for the
   * "Add New Card" flow in the adaptation editor.
   *
   * These bridge functions are registered as globals on the window object
   * and connect the OVP runtime (in the preview iframe) to the server-side
   * adaptation tooling middleware via fetch requests.
   */
  function initOvpWindowFunctions() {
    // OVP runtime expects these as window globals
    // eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-define
    window.writeToI18n = writeToI18n;
    // eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-define
    window.getNewDataSources = getNewDataSources;
    // eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-define
    window.getMetaModelForNewDataSource = getMetaModelForNewDataSource;
    log.info('OVP bridge functions initialized (writeToI18n, getNewDataSources, getMetaModelForNewDataSource)');
  }
  var __exports = {
    __esModule: true
  };
  __exports.initOvpWindowFunctions = initOvpWindowFunctions;
  return __exports;
});
//# sourceMappingURL=ovp-window-functions.js.map