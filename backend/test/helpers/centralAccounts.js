const {createMariaAccountService}=require('../../../central-accounts/mariadb/accountService');
const {createFakeMariaPool}=require('../../../central-accounts/mariadb/fakePool');
exports.createAccountService=options=>{const pool=createFakeMariaPool();return {...createMariaAccountService({...options,pool}),testPool:pool};};
