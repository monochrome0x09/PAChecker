"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";

type Subject={id:number;name:string};
type Draft={id:number;sourceImageId:number;sourceImageUrl?:string;status:string;extractedCore:{subjectId?:number;subjectName?:string;title?:string;assessmentDate?:string;description?:string|null;materials?:string|null;status?:string}|null;extraFields:Record<string,unknown>;errorMessage?:string|null};
type Row={id:string;key:string;value:string;json:boolean};
async function json<T>(r:Response):Promise<T>{const d=await r.json() as T&{error?:string};if(!r.ok)throw new Error(d.error??"요청 처리에 실패했습니다.");return d;}
function draftOf(v:Draft|{draft:Draft}){return "draft" in v?v.draft:v;}
function rowsOf(fields:Record<string,unknown>):Row[]{return Object.entries(fields).map(([key,value],i)=>({id:`${i}-${key}`,key,value:typeof value==="string"?value:JSON.stringify(value),json:typeof value!=="string"}));}

export default function ReviewDraftPage(){
 const {id}=useParams<{id:string}>(); const router=useRouter();
 const [subjects,setSubjects]=useState<Subject[]>([]); const [draft,setDraft]=useState<Draft|null>(null); const [rows,setRows]=useState<Row[]>([]);
 const [form,setForm]=useState({subjectId:"",title:"",assessmentDate:"",description:"",materials:"",status:"pending"});
 const [loading,setLoading]=useState(true); const [busy,setBusy]=useState(false); const [error,setError]=useState<string|null>(null);
 const load=useCallback(async()=>{try{setError(null);const [dr,sr]=await Promise.all([fetch(`/api/ai/drafts/${id}`,{cache:"no-store"}),fetch("/api/subjects",{cache:"no-store"})]);const [raw,ss]=await Promise.all([json<Draft|{draft:Draft}>(dr),json<Subject[]>(sr)]);const d=draftOf(raw);const core=d.extractedCore??{};const matchedSubject=core.subjectName?ss.find(subject=>subject.name.trim().toLocaleLowerCase("ko-KR")===core.subjectName?.trim().toLocaleLowerCase("ko-KR")):undefined;setDraft(d);setSubjects(ss);setRows(rowsOf(d.extraFields??{}));setForm({subjectId:core.subjectId?String(core.subjectId):matchedSubject?String(matchedSubject.id):"",title:core.title??"",assessmentDate:(core.assessmentDate??"").slice(0,10),description:core.description??"",materials:core.materials??"",status:core.status==="completed"?"completed":"pending"});}catch(e){setError(e instanceof Error?e.message:"초안을 불러오지 못했습니다.");}finally{setLoading(false)}},[id]);
 useEffect(()=>{// eslint-disable-next-line react-hooks/set-state-in-effect
 void load()},[load]);
 function extra(){const out:Record<string,unknown>={};for(const row of rows){const key=row.key.trim();if(!key&&!row.value.trim())continue;if(!key)throw new Error("추가 정보의 항목명을 입력해주세요.");if(Object.hasOwn(out,key))throw new Error("추가 정보 항목명이 중복되었습니다.");if(row.json){try{out[key]=JSON.parse(row.value)}catch{throw new Error(`${key} 항목의 JSON 형식을 확인해주세요.`)}}else out[key]=row.value.trim();}return out;}
 async function discard(){if(!window.confirm("이 분석 초안과 연결된 원본 이미지를 삭제하시겠습니까?"))return;try{setBusy(true);setError(null);await json(await fetch(`/api/ai/drafts/${id}`,{method:"DELETE"}));router.push("/assessments");}catch(e){setError(e instanceof Error?e.message:"초안을 폐기하지 못했습니다.");setBusy(false)}}
 async function confirm(event:FormEvent){event.preventDefault();try{setBusy(true);setError(null);const payload={extractedCore:{subjectId:Number(form.subjectId),title:form.title,assessmentDate:form.assessmentDate,description:form.description,materials:form.materials,status:form.status},extraFields:extra()};await json(await fetch(`/api/ai/drafts/${id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}));const result=await json<{assessmentId:number}>(await fetch(`/api/ai/drafts/${id}/confirm`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,notificationOffsets:[7,3,1,0]})}));router.push(`/assessments/${result.assessmentId}`);}catch(e){setError(e instanceof Error?e.message:"초안을 저장하지 못했습니다.");setBusy(false)}}
 if(loading)return <main className={styles.page}><p className={styles.loadingState} aria-live="polite">분석 초안을 불러오는 중...</p></main>;
 if(!draft)return <main className={styles.page}><p className={styles.error} role="alert">{error??"초안을 찾을 수 없습니다."}</p><Link className={styles.stateLink} href="/assessments/import">다시 업로드</Link></main>;
 return <main className={styles.page}><header className={styles.header}><Link href="/assessments/import">← 이미지 다시 선택</Link><p>PACHECKER / REVIEW</p><h1>AI 분석 결과 확인</h1><span>붉은 경고나 누락된 값을 원본과 비교한 뒤 확정하세요.</span></header>
  {error&&<p className={styles.error} role="alert">{error}</p>}
  {draft.errorMessage&&<p className={styles.error} role="alert">분석 경고: {draft.errorMessage}</p>}
  <form className={styles.layout} onSubmit={confirm} aria-busy={busy}>
   <aside className={styles.imageCard}><h2>원본 이미지</h2>{/* The protected API image is intentionally loaded without the public image optimizer. */}<img /* eslint-disable-line @next/next/no-img-element */ src={draft.sourceImageUrl??`/api/uploads/${draft.sourceImageId}`} alt="업로드한 수행평가지 원본"/><a href={draft.sourceImageUrl??`/api/uploads/${draft.sourceImageId}`} target="_blank" rel="noreferrer">원본 크게 보기</a></aside>
   <section className={styles.formCard}><h2>추출된 핵심 정보</h2><div className={styles.grid}>
    <label>과목<select required value={form.subjectId} onChange={e=>setForm({...form,subjectId:e.target.value})}><option value="">과목 선택</option>{subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>상태<select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="pending">진행 중</option><option value="completed">완료</option></select></label>
    <label className={styles.wide}>제목<input required maxLength={200} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
    <label>평가 날짜<input required type="date" value={form.assessmentDate} onChange={e=>setForm({...form,assessmentDate:e.target.value})}/></label>
    <label className={styles.wide}>설명<textarea rows={4} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
    <label className={styles.wide}>준비물<textarea rows={3} value={form.materials} onChange={e=>setForm({...form,materials:e.target.value})}/></label>
   </div><div className={styles.extraHead}><h2>추가 정보</h2><button type="button" onClick={()=>setRows([...rows,{id:crypto.randomUUID(),key:"",value:"",json:false}])}>+ 항목</button></div>
   {rows.map((row,index)=><div className={styles.extraRow} key={row.id}><input aria-label={`추가 정보 ${index+1} 이름`} placeholder="항목명" value={row.key} onChange={e=>setRows(rows.map(r=>r.id===row.id?{...r,key:e.target.value}:r))}/><input aria-label={`추가 정보 ${index+1} 내용`} placeholder={row.json?"JSON 내용":"내용"} value={row.value} onChange={e=>setRows(rows.map(r=>r.id===row.id?{...r,value:e.target.value}:r))}/><button type="button" onClick={()=>setRows(rows.filter(r=>r.id!==row.id))}>삭제</button></div>)}
   <div className={styles.actions}><button className={styles.discard} disabled={busy} type="button" onClick={()=>void discard()}>초안 폐기</button><button disabled={busy} type="submit">{busy?"확정 저장 중...":"검토 완료 및 수행평가 저장"}</button></div></section>
  </form></main>;
}
