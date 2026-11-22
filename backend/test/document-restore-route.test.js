const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mojateczka-document-restore-'));process.chdir(root);process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL='';
const {createDocumentRouter}=require('../routes/documents');
test('restore accepts the desktop payload and resets retention while validating dates and destination ownership',async()=>{
 let current={id:1,folderId:2,filePath:'restore.pdf',title:'Restore',isDeleted:true,isArchived:false,deletedAt:new Date(),createdAt:new Date('2000-01-01')};
 fs.writeFileSync(path.join(root,'uploads','restore.pdf'),'%PDF-test-restore');
 const documents={findFirst:async({where})=>where.id===1&&where.folder.ownerId===1?current:null,findMany:async({select})=>select?.id?[{id:1}]:[],update:async({data})=>{current={...current,...data};return {...current,tags:[]};}};
 const prisma={document:documents,subscription:{findUnique:async()=>null},folder:{findFirst:async({where})=>where.id===2&&where.ownerId===1?{parentId:1}:null},$transaction:async fn=>fn({document:documents})};
 const app=express();app.use(express.json());app.use((req,res,next)=>{res.locals.userId=1;res.locals.billingOwnerKey='user:1';next();});app.use('/documents',createDocumentRouter(prisma));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const patch=(body,id=1)=>fetch(`http://127.0.0.1:${server.address().port}/documents/${id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  const date=new Date().toISOString(),body={isArchived:false,isDeleted:false,deletedAt:null,folderId:2,createdAt:date,retentionEnabled:true,retentionValue:5,retentionUnit:'years'};
  const response=await patch(body);assert.equal(response.status,200,await response.clone().text());assert.equal(current.isDeleted,false);assert.equal(current.deletedAt,null);assert.equal(current.createdAt,date);assert.equal(current.folderId,2);
  current={...current,isArchived:true};assert.equal((await patch(body)).status,200);assert.equal(current.isArchived,false);
  assert.equal((await patch({...body,createdAt:'invalid-date'})).status,400);assert.equal((await patch({...body,folderId:999})).status,400);assert.equal((await patch(body,999)).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));process.chdir(os.tmpdir());fs.rmSync(root,{recursive:true,force:true});}
});
