using { mobi.db as db } from '../db/schema';

@requires: 'authenticated-user'
service VlGlAccounts {

    @restrict: [
        { grant: 'READ', to: 'Read' },
        { grant: '*',    to: 'Admin' }
    ]
    entity valuelookup as projection on db.MOBI_DB_GLAccounts;

    @requires: 'Read'
    action validateGLAccounts(
        glAccounts : array of String
    ) returns array of String;

     @requires: 'Admin'
    action uploadExcelData(
        data : many valuelookup
    ) returns String;

    @requires: 'Read'
    action displayGLData()
        returns many valuelookup;
}