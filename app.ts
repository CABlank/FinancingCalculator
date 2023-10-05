function greet(name: string): string {
  return `Hello, ${name}!`;
}

import path from 'path';
import express, { Request, Response } from 'express';
import { Readable } from 'stream';

import { parse } from 'date-fns';

interface DeferralData {
  pvDate?: Date;
  from: Date;
  to: Date;
  compoundFreq: number;
  paymentFreq: number;
}

interface CfArray {
  RowID: number;
  PmtNmbr: number;
  RootPmtPntr: number[];
  CaseCode: string;
  Date: Date;
  Amount: number;
  DiscountFactor?: number;
  DCF: number;
  Kind: number;
  Escrow: boolean;
  Unknown: boolean;
  Freq: string;
  Owner: string;
  dcfStubPeriods: number;
  dcfStubDays: number;
  stubPeriods: number;
  stubDays: number;
}

type AnnuityArray = CfArray[];

interface Answer {
  PV: number;
  DCFpv: number;
  DCFRounding: number;
  Rate: number;
  UnknownRow: number; 
  Answer: number;
  Rounding: number;
  WAL: number;
  HWMark: number; 
  HWMarkDate: string; 
  Term: number;
  IsAmSchedule: boolean; 
  TotalPayout: number; 
  isPmtSchedule: boolean;
  AmSchedule: Schedule[]; 
  YeValuations: YearEnd[]; 
}

interface CashFlow {
  CaseCode: string;
  ParentChild: string;
  Buyer: string;
  CfType: string;
  First: string;
  Last: string;
  Number: number;
  Amount: number;
  Frequency: string;
  COLA: number;
  ColaPeriods: number;
  Unknown: boolean;
  Escrow: boolean;
}


interface Annuity {
  DCFCode: string;
  Compounding: string;
  Effective: number;
  Nominal: number;
  Label: string;
  DailyRate: number;
  Desc: string;
  Type: string;
  Unknown: boolean;
  UseAmSchedule: boolean;
  EstimateDCF: number;
  AsOf: Date;
  CashFlows: CashFlow[];
  Carrier: string;
  Aggregate: number;
  CustomCF: boolean;
  DocumentRecipient: string;
}


interface Schedule {
  Type?: string;
  Date: string;
  Payment: number;
  Cashflow?: number;
  Principal?: number;
  Interest?: number;
  DCFPrincipal?: number;
  DCFInterest?: number;
  DCFBalance?: number;
  Balance?: number;
}

interface ScheduleData {
  balance?: number;
  accruedInterest?: number;
  principal?: number;
}

interface YearEnd {
  Date: string;
  Value: number;
  Aggregate: number; 
  YearlyDCFInterest?: number; 
  YearlyInterest: number;
  YearlyCumulative: number;
}






const FreqMap: { [key: string]: number } = {
  Monthly: 12,
  Quarterly: 4,
  SemiAnnual: 2,
  Annual: 1,
  Payment: 0,
};




async function calc(req: Request, schedule: boolean): Promise<{ answer: Answer | Error | null; annuity: Annuity | undefined; error: Answer | Error | null }> {
  const result: { answer: Answer | Error | null; annuity: Annuity | undefined; error: Answer | Error | null } = {
    answer: null,
    annuity: undefined,
    error: null,
  };

  if (req.headers['content-length'] === '0') {
    result.error = new Error('Please send a request body');
    return result;
  }

  const annuityResponse  = await NewAnnuity(req);
  
  if (!annuityResponse.error) {
    const [ answer, error ] = await calcAnnuity(annuityResponse.annuity, schedule);
    if(error) {
      result.answer = answer;
      result.error = error;
    }
  }

  return result;
}

async function NewAnnuity(req: Request): Promise<{ error: Error | null; annuity: Annuity | null }> {
  let annuity: Annuity | null = null;
  let error: Error | null = null;

  try {
    const annuityBuffer: Uint8Array[] = [];
    const readable = req.body as Readable;

    for await (const chunk of readable) {
      annuityBuffer.push(chunk);
    }

    const annuityData = Buffer.concat(annuityBuffer).toString('utf-8');
    annuity = JSON.parse(annuityData);
  } catch (err) {
    if (err instanceof Error) {
      error = err;
    }
  }

  return { error, annuity };
}








































async function calcAnnuity(annuity: Annuity | null, schedule: boolean | null) {
  let err = null;
  const result: Answer = {} as Answer
  console.log("Starting calcAnnuity function...");

  if(annuity) {
    let aa = [];
    
      [aa, annuity.AsOf] = newCashflowArray(annuity.CashFlows, annuity.Compounding);
      console.log("Cashflow Array:", aa);
      setStubs(aa, annuity);
    

    if (annuity.Unknown) {
      result.UnknownRow = -1;
      [result.Answer, err] = await amortizeRate(aa, annuity);
      annuity.Effective = effective(result.Answer);
      console.log("Solving for rate:", result.Answer);

    } else {
      result.UnknownRow = getUnknownRow(annuity);
      annuity.DailyRate = annuity.Nominal / 365;
      [result.Answer, err] = await amortizeCF(aa, annuity, result.UnknownRow);
      console.log("Solving for cashflow:", result.Answer);
    }

    if (err === null) {
      result.PV = getAnnuityPV(aa, annuity.AsOf);
      console.log("Annuity PV:", result.PV);

      if (result.PV !== 0 && result.DCFpv === 0) {
        result.DCFpv = estimatePV(aa, annuity.Effective);
        console.log("DCFpv:", result.DCFpv);
      }
      
      annuity.Aggregate = toFixed(aaAggregate(aa), 2);
      result.WAL = calcWAL(aa, annuity.Aggregate);
      console.log("WAL:", result.WAL);

      if (schedule) {
        result.AmSchedule = createAmSchedule(result, aa, annuity, paymentCount(annuity.CashFlows));
        result.YeValuations = yearEndSummary(aa, annuity, result);
        console.log("Schedule & Year-end valuations created.");
      }

      result.TotalPayout = annuity.Aggregate;
      console.log("Total payout:", result.TotalPayout);
    }
    
  }  else {
    console.log("Annuity is null. Exiting...");
  }
  
  return [result, err];
}

function newCashflowArray(pmts: CashFlow[], compounding: string): [AnnuityArray, Date] {
  console.log("newCashflowArray called with:", pmts, compounding);

  let pFreq: number;
  let cfType: number;
  let i: number = 0;
  let firstPaymentDate: Date;
  let asOf: Date = new Date();
  let sortRequired = false, asOfBool = false;
  const aa: AnnuityArray = new Array<CfArray>(paymentCount(pmts));

  console.log("Initial AnnuityArray:", aa);

  for (let row = 0; row < pmts.length; row++) {
    const v = pmts[row];
    firstPaymentDate = parseDateFromString(v.First);
    let amount = v.Amount;
    let tracker = amount;

    console.log(`Processing payment at index ${row}:`, v);

    if (v.COLA !== 0 && v.ColaPeriods === 0) {
      pmts[row].ColaPeriods = FreqMap[v.Frequency];
      console.log("Updated ColaPeriods for payment:", pmts[row]);
    }

    if (v.CfType === "Invest") {
      cfType = -1;
      if (!asOfBool) {
        asOf = firstPaymentDate;
        asOfBool = true;
        console.log("Updated asOf date based on Invest type:", asOf);
      }
    } else {
      cfType = 1;
    }

    pFreq = FreqMap[v.Frequency] || FreqMap[compounding];
    pFreq = 12 / pFreq;
    const escrow = v.Escrow;

    if (i > 0 && !sortRequired) {
      sortRequired = compareDates(firstPaymentDate, aa[i - 1].Date);
    }

    for (let j = 0; j < v.Number; j++) {
      aa[i] = {
        RowID: row,
        Date: addMonths(firstPaymentDate, j * pFreq),
        Amount: amount,
        Kind: cfType,
        Escrow: escrow,
        CaseCode: v.CaseCode,
        Owner: v.Buyer,
        PmtNmbr: i,
        Freq: v.Frequency,
        RootPmtPntr: [],  
        DCF: 0, 
        Unknown: false,  
        dcfStubPeriods: 0,  
        dcfStubDays: 0, 
        stubPeriods: 0, 
        stubDays: 0 
    };
      console.log(`Updated AnnuityArray at index ${i}:`, aa[i]);
      i++;

      if ((j + 1) * pFreq % 12 === 0 && v.COLA !== 0 && j !== v.Number - 1) {
        tracker *= 1.0 + v.COLA;
        amount = toFixed(tracker, 2); 
      }
    }
  }

  if (sortRequired) {
    aa.sort((a, b) => {
      if (a.Date < b.Date) {
        return -1;
      } else if (a.Date > b.Date) {
        return 1;
      } else {
        return a.RowID! - b.RowID!;
      }
    });
    console.log("Sorted AnnuityArray:", aa);
  }
  console.log("Returning from newCashflowArray with:", aa, asOf);
  return [aa, asOf];
}

function getAnnuityPV(aa: AnnuityArray, d: Date): number {
  for (let i = 0; i < aa.length; i++) {
    if (aa[i].Date.getTime() === d.getTime() && aa[i].Kind === -1) {
      return aa[i].Amount;
    }
  }
  return 0;
}

function parseDateFromString(timeString: string): Date {
  if (timeString.includes("-")) {
    return parseInvntoryDateFormat(timeString);
  }
  return parseFBDateFormat(timeString);
}

function parseInvntoryDateFormat(d: string): Date {
  const thisDate = new Date(d); 
  return thisDate;
}

function parseFBDateFormat(d: string): Date {
  const thisDate = new Date(d); 
  return thisDate;
}

function compareDates(now: Date, prior: Date): boolean {
  const compared = prior > now;
  return compared;
}




function getInvestmentValue(annuity: Annuity): number {
  for (let cashFlow of annuity.CashFlows) {
    if (cashFlow.CfType === "Invest") {
      return cashFlow.Amount;
    }
  }
  return 0;
}

function addMonths(date: Date, offset: number): Date {
  const tDate = new Date(date);
  let dayOfMonth = date.getDate();

  if (dayOfMonth > 28) {
    date = setDate(date, 28);
  }

  date.setMonth(date.getMonth() + offset);

  if (
    dayOfMonth === daysInMonth(tDate.getFullYear(), tDate.getMonth() + 1) ||
    dayOfMonth > daysInMonth(date.getFullYear(), date.getMonth() + 1)
  ) {
    return setDate(date, daysInMonth(date.getFullYear(), date.getMonth() + 1));
  }

  return setDate(date, dayOfMonth);
}

function setDate(date: Date, day: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), day, 0, 0, 0, 0);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function lastPaymentDate(firstPaymentDate: Date, numberPmts: number, frequency: string): Date {
  if (!FreqMap[frequency]) {
    return firstPaymentDate;
  }
  return addMonths(firstPaymentDate, (numberPmts - 1) * (12 / FreqMap[frequency]));
}

function paymentCount(cfs: CashFlow[]): number {
  return cfs.reduce((sum, cf) => sum + cf.Number, 0);
}

function stringifyWalTerm(r: Answer): [string, string] {
  const termString = r.Term.toFixed(1);
  const walString = r.WAL.toFixed(1);
  return [termString, walString];
}

function calcWAL(aa: AnnuityArray, aggregate: number): number {
  let walAgg = 0;
  let dayDiff: number;
  let walDate: Date | null = null;

  for (const v of aa) {
    if (v.Kind !== 1) {
      if (!walDate) {
        walDate = v.Date;
      }
      continue;
    }

    if (!walDate) {
      walDate = v.Date;
      continue;
    }

    dayDiff = diffDays(v.Date, walDate);
    walAgg += dayDiff * v.Amount;
  }

  return toFixed(walAgg / (aggregate * 365), 1);
}

function calcWALWithAggregate(aa: CfArray[], aggregate: number): number {
  let walAgg = 0;
  let dayDiff: number;
  let walDate: Date | null = null;
  for (let v of aa) {
    if (v.Kind !== 1) {
      if (!walDate) {
        walDate = v.Date;
      }
      continue;
    }

    dayDiff = diffDays(v.Date, walDate!);
    walAgg += dayDiff * v.Amount;
  }
  return toFixed(walAgg / aggregate / 365, 1);
}

function nominal(rate: number): number {
  return 12.0 * (Math.pow(rate + 1.0, 1.0 / 12.0) - 1.0);
}

function effective(rate: number): number {
  return Math.pow(1.0 + (rate / 12), 12) - 1;
}

function aaAggregate(aa: CfArray[]): number {
  return aa.reduce((agg, v) => v.Kind === 1 ? agg + v.Amount : agg, 0);
}

function getInvestmentDate(aa: CfArray[]): Date {
  for (let item of aa) {
    if (item.Kind === -1) {
      return item.Date;
    }
  }
  return aa[aa.length - 1].Date;
}

function diffDays(a: Date, b: Date): number {
  const difference = a.getTime() - b.getTime();
  return Math.floor(difference / (1000 * 3600 * 24));
}

function estimatePV(aa: CfArray[], rate: number): number {
  let pvEstimate = 0;
  const pvDate = getInvestmentDate(aa);
  for (let i = 0; i < aa.length; i++) {
    const v = aa[i];
    if (pvDate.getTime() === v.Date.getTime() && v.Kind === -1) {
      continue;
    } else {
      if (v.dcfStubPeriods !== undefined && v.dcfStubDays !== undefined) {
        const period = v.dcfStubPeriods + (v.dcfStubDays / 365 * 12);
        aa[i].DiscountFactor = (1 / Math.pow(1 + rate, period / 12)) * v.Kind;
        aa[i].DCF = toFixed(aa[i].DiscountFactor! * aa[i].Amount, 2);
        pvEstimate += aa[i].DCF!;

      }
    }
  }
  return pvEstimate;
}

function setStubs(aa: CfArray[], annuity: Annuity): void {
  const compounding: number = 12 / FreqMap[annuity.Compounding];
  let payPeriod: number;

  const data: DeferralData = {
      pvDate: aa[0].Date,
      from: aa[0].Date,
      to: aa[0].Date,
      compoundFreq: compounding,
      paymentFreq: 1,
  };

  for (let i = 0; i < aa.length; i++) {
      const v = aa[i];
      if (i === 0 || aa[0].Date === v.Date) {

          aa[i].stubDays = aa[i].stubPeriods = aa[i].dcfStubDays = aa[i].dcfStubPeriods = 0;
          continue;
      }

      data.from = aa[i - 1].Date;
      data.to = v.Date;
      data.paymentFreq = FreqMap[annuity.CashFlows[v.RowID!].Frequency] || 0;
      if (data.paymentFreq !== 0) {
          data.paymentFreq = 12 / data.paymentFreq;
      } else {
          data.paymentFreq = 1;
      }

      if (v.RowID === aa[i - 1].RowID) {
          payPeriod = data.paymentFreq / data.compoundFreq;
          aa[i].stubDays = 0;
          aa[i].stubPeriods = payPeriod;
      } else {
          [aa[i].stubDays, aa[i].stubPeriods] = createStubs(data);
      }

      data.from = data.pvDate!;
      [aa[i].dcfStubDays, aa[i].dcfStubPeriods] = createStubs(data);
  }
}

function createStubs(data: DeferralData): [number, number] {
  let countMonths = data.to.getMonth() - data.from.getMonth() + (12 * (data.to.getFullYear() - data.from.getFullYear()));
  if (countMonths !== 0) {
      if (data.to.getDate() < data.from.getDate()) {
          countMonths--;
          if (data.to.getDate() === daysInMonth(data.to.getFullYear(), data.to.getMonth())) {
              countMonths++;
          }
      }
  }
  const countPeriods = Math.floor(countMonths / data.compoundFreq);
  const dt = addMonths(data.to, -countPeriods * data.compoundFreq);
  const stubDays = diffDays(dt, data.from);
  return [stubDays, countPeriods];
}

async function amortizeRate(aa: AnnuityArray, annuity: Annuity): Promise<[number, Error | null]> {
  let guess = 0, balance = 0, min = -1, max = 1;
  while (max - min > 0.0000001) {
      guess = (min + max) / 2;
      if (min > 0.99999 || max < -0.99999) {
          return [0, new Error(`interest rate out of range error with guessed rate = ${guess} and annuity pv = ${annuity.CashFlows[0].Amount}`)];
      }
      annuity.Nominal = guess;
      annuity.DailyRate = annuity.Nominal / 365;
      balance = amortize(aa, annuity);
      if (balance > 0) {
          max = guess;
      } else {
          min = guess;
      }
  }
  return [guess, null];
}

async function amortizeCF(aa: AnnuityArray, annuity: Annuity, unknownRow: number): Promise<[number, Error | null]> {
  let guess = 0, floor = -10000000, ceiling = 10000000, iterations = 0;
  let min: number, max: number;
  if (annuity.CashFlows[unknownRow].CfType === "Invest") {
      annuity.EstimateDCF = estimatePV(aa, annuity.Effective);
      min = annuity.EstimateDCF - (annuity.EstimateDCF * 0.009);
      max = annuity.EstimateDCF + (annuity.EstimateDCF * 0.009);
      console.log("Estimated NPV for", annuity.DCFCode, annuity.EstimateDCF, "Rate:", annuity.Effective, min, max);
  } else {
      min = floor;
      max = ceiling;
  }
  while (max - min > 0.001) {
      iterations++;
      guess = (min + max) / 2;
      if (max < floor + 0.01 || min > ceiling - 0.01) {
          return [0, new Error("ERROR - the cash flow has iterated beyond the max/min range - check that your variables are correct")];
      }
      updateAnnuity(aa, guess, annuity, unknownRow);
      let balance = amortize(aa, annuity);
      if ((annuity.CashFlows[unknownRow].CfType === "Invest" && balance < 0) || (annuity.CashFlows[unknownRow].CfType !== "Invest" && balance > 0)) {
          min = guess;
      } else {
          max = guess;
      }
  }
  console.log("Number of iterations:", iterations);
  if (annuity.CashFlows[unknownRow].COLA !== 0) {
      updateAnnuity(aa, toFixed(guess, 2), annuity, unknownRow);
  }
  return [toFixed(guess, 2), null];
}

function amortize(aa: AnnuityArray, annuity: Annuity): number {
  let interest = 0, balance = 0;
  for (const v of aa) {
      interest = v.stubDays! * annuity.DailyRate * balance;
      balance += interest;
      balance *= Math.pow(1 + annuity.Nominal / FreqMap[annuity.Compounding], v.stubPeriods!);
      balance -= v.Amount * v.Kind;
  }
  return balance;
}

function updateAnnuity(aa: AnnuityArray, guess: number, annuity: Annuity, row: number) {
  let paymentsRemaining = annuity.CashFlows[row].Number;
  for (let i = 0; i < aa.length; i++) {
      if (aa[i].RowID === row) {
          const paymentsIndex = annuity.CashFlows[row].Number - paymentsRemaining;
          if (annuity.CashFlows[row].COLA !== 0 && paymentsIndex > 0 && paymentsIndex % annuity.CashFlows[row].ColaPeriods === 0) {
              guess *= 1 + annuity.CashFlows[row].COLA;
          }
          aa[i].Amount = guess;
          paymentsRemaining--;
          if (paymentsRemaining === 0) {
              break;
          }
      }
  }
}

function getUnknownRow(annuity: Annuity): number {
  for (let row = 0; row < annuity.CashFlows.length; row++) {
      if (annuity.CashFlows[row].Unknown) {
          return row;
      }
  }
  console.error("No unknown cashflow error!");
  return -1;
}

function round(num: number): number {
  return Math.floor(num + 0.5);
}

function toFixed(num: number, precision: number): number {
  const output = Math.pow(10, precision);
  return Math.round(num * output) / output;
}

function createAmSchedule(result: Answer, aa: AnnuityArray, annuity: Annuity, sum: number): Schedule[] {
  result.AmSchedule = new Array<Schedule>(sum);
  result.HWMark = 0;
  result.DCFRounding = result.DCFpv - result.PV;

  for (let i = 0; i < aa.length; i++) {
      result.AmSchedule[i] = schedRow(aa, i, annuity, result);
  }

  const lastElement = result.AmSchedule.length - 1;

  if (result.HWMarkDate === result.AmSchedule[lastElement].Date) {
      result.HWMark = result.AmSchedule[lastElement].Payment;
  }

  result.Rounding = result.AmSchedule[lastElement].Balance!;
  result.AmSchedule[lastElement].Interest! -= result.Rounding;
  result.AmSchedule[lastElement].Principal! += result.Rounding;
  result.AmSchedule[lastElement].Balance = 0;

  roundFirstDCFPayment(result, annuity);


  result.AmSchedule = insertSchedTotals(result); 

  annuity.Aggregate = result.AmSchedule[result.AmSchedule.length - 1].Payment;

  return result.AmSchedule;
}

function roundFirstDCFPayment(result: Answer, annuity: Annuity): void {
  for (let i = 0; i < result.AmSchedule.length; i++) {
      const d = new Date(result.AmSchedule[i].Date);

      if (result.AmSchedule[i].Type === "Return" && d.getTime() !== annuity.AsOf.getTime()) {
          result.AmSchedule[i].DCFPrincipal! += toFixed(result.PV - result.DCFpv, 2);
          result.AmSchedule[i].DCFInterest! -= toFixed(result.PV - result.DCFpv, 2);
          break;
      }
  }
}

function schedRow(aa: AnnuityArray, index: number, annuity: Annuity, result: Answer): Schedule {
  const data: ScheduleData = {};
  const AnnuityArrayAtIndex = aa[index];

  if (index === 0) {
      return amSchedReturnVals(data, AnnuityArrayAtIndex, index);
  }

  const previousBalance = result.AmSchedule[index - 1].Balance!;
  const stubInterest = AnnuityArrayAtIndex.stubDays! * annuity.DailyRate * previousBalance;

  data.balance = stubInterest + previousBalance;
  data.balance *= Math.pow(1 + annuity.Nominal / FreqMap[annuity.Compounding], AnnuityArrayAtIndex.stubPeriods!);

  if (result.HWMark < data.balance) {
      result.HWMark = data.balance!;
      result.HWMarkDate = (new Date(AnnuityArrayAtIndex.Date)).toLocaleDateString("en-US", { month: '2-digit', day: '2-digit', year: 'numeric' });
  }

  data.accruedInterest = data.balance! - previousBalance;
  data.balance -= AnnuityArrayAtIndex.Amount * AnnuityArrayAtIndex.Kind;
  data.balance = toFixed(data.balance!, 2);

  data.principal = toFixed(previousBalance - data.balance!, 2);
  return amSchedReturnVals(data, AnnuityArrayAtIndex, index);
}


function amSchedReturnVals(data: ScheduleData, AnnuityArrayAtIndex: CfArray, index: number): Schedule {
  const s: Schedule = {
    Date: AnnuityArrayAtIndex.Date.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    Payment: AnnuityArrayAtIndex.Amount,
  };

  if (AnnuityArrayAtIndex.Kind === 1) {
    s.Type = 'Return';
    s.DCFInterest = toFixed(AnnuityArrayAtIndex.Amount - AnnuityArrayAtIndex.DCF!, 2);
    s.DCFPrincipal = AnnuityArrayAtIndex.DCF!;
    if (index === 0) {
      data.balance = toFixed(-AnnuityArrayAtIndex.Amount * AnnuityArrayAtIndex.Kind, 2);
    } else {
      s.Principal = data.principal!;
      s.Interest = AnnuityArrayAtIndex.Amount - data.principal!;
    }
  } else {
    s.Type = 'Invest';
    if (index === 0) {
      data.balance = toFixed(-AnnuityArrayAtIndex.Amount * AnnuityArrayAtIndex.Kind, 2);
      s.DCFPrincipal = AnnuityArrayAtIndex.Amount;
    } else {
      s.Interest = data.accruedInterest!;
      s.DCFInterest = toFixed(AnnuityArrayAtIndex.Amount - AnnuityArrayAtIndex.DCF!, 2);
    }
  }

  s.Balance = data.balance!;
  return s;
}


function insertSchedTotals(result: Answer): Schedule[] {
  let empty: Schedule;
  let i: number = 0;
  let year: string = result.AmSchedule[0].Date.slice(-4);

  interface Total {
      payments: number;
      interest: number;
      dcfPayments: number;
      dcfInterest: number;
      totalPayments: number;
      totalInterest: number;
      totalDCFPayments: number;
      totalDCFInterest: number;
  }

  const totals: Total = {
      payments: 0,
      interest: 0,
      dcfPayments: 0,
      dcfInterest: 0,
      totalPayments: 0,
      totalInterest: 0,
      totalDCFPayments: 0,
      totalDCFInterest: 0
  };

  const insertTotals = (): Schedule => ({
      Type: year + " Totals",
      Date: "",
      Payment: totals.payments,
      Principal: totals.payments - totals.interest,
      Interest: totals.interest,
      DCFPrincipal: totals.payments - totals.dcfInterest,
      DCFInterest: totals.dcfInterest,
  });

  for (i = 0; i < result.AmSchedule.length; i++) {
      if (year !== result.AmSchedule[i].Date.slice(-4)) {
          result.AmSchedule.splice(i, 0, empty!);
          result.AmSchedule[i] = insertTotals();
          totals.payments = 0;
          totals.interest = 0;
          totals.dcfPayments = 0;
          totals.dcfInterest = 0;
          year = result.AmSchedule[i + 1].Date.slice(-4);
      } else {
          if (result.AmSchedule[i].Type === "Return") {
              totals.payments += toFixed(result.AmSchedule[i].Payment, 2);
              totals.interest += toFixed(result.AmSchedule[i].Interest!, 2);
              totals.dcfInterest += toFixed(result.AmSchedule[i].DCFInterest!, 2);
              totals.totalDCFInterest += toFixed(result.AmSchedule[i].DCFInterest!, 2);
              totals.totalPayments += toFixed(result.AmSchedule[i].Payment, 2);
              totals.totalInterest += toFixed(result.AmSchedule[i].Interest!, 2);
          }
      }
  }

  result.AmSchedule.push(insertTotals());
  result.AmSchedule.push({
      Type: "Grand Totals",
      Date: "",
      Payment: totals.totalPayments,
      Principal: totals.totalPayments - totals.totalInterest,
      Interest: totals.totalInterest,
      DCFPrincipal: totals.totalPayments - totals.totalDCFInterest,
      DCFInterest: totals.totalDCFInterest,
  });

  return result.AmSchedule;
}

function amortizeYE(c: AnnuityArray, annuity: Annuity) {
  let min: number = -100000000;
  let max: number = 100000000;

  while (max - min > 0.0001) {
      c[0].Amount = (min + max) / 2;
      let balance: number = amortize(c, annuity);
      if (balance > 0) {
          max = c[0].Amount;
      } else {
          min = c[0].Amount;
      }
  }
}



function yearEndSummary(aa: AnnuityArray, annuity: Annuity, result: Answer): YearEnd[] {
    result.IsAmSchedule = annuity.UseAmSchedule;
    const finalPaymentDate = aa[aa.length - 1].Date;
    const finalYear = finalPaymentDate.getFullYear();
    const compounding = 12 / FreqMap[annuity.Compounding];
    const ye: YearEnd[] = new Array(finalYear - aa[0].Date.getFullYear() + 1);
    let c: CfArray[] = [...aa];
    let pFreq = 0;
    let yeIndex = 0;
    let aggregate = 0;
    let cumulativeAgg = 0;
    const startYear = aa[0].Date.getFullYear();

    if (startYear === finalYear) {
        return [{
            Date: finalYear.toString(),
            Value: 0,
            Aggregate: aaAggregate(aa),
            YearlyInterest: getDCFYearlyInterest(startYear, result),
            YearlyCumulative: aggregate
        }];
    }

    for (let thisYear = startYear; thisYear < finalYear; thisYear++) {
        [c, aggregate, cumulativeAgg, yeIndex] = getYearEndValues(annuity, finalPaymentDate, c, aggregate, cumulativeAgg, thisYear, pFreq, compounding, yeIndex, startYear, ye, result);
        cumulativeAgg += aggregate;
    }

    for (let i = 0; i < c.length; i++) {
        if (c[i].Kind !== -1) {
            aggregate += c[i].Amount;
        }
    }

    ye[yeIndex + 1] = {
        Date: finalYear.toString(),
        Value: 0,
        Aggregate: aggregate,
        YearlyInterest: getDCFYearlyInterest(finalYear, result),
        YearlyCumulative: cumulativeAgg + aggregate
    };

    return ye;
}


function getYearEndValues(annuity: Annuity, finalPaymentDate: Date, c: CfArray[], aggregate: number, cumulative: number, thisYear: number, pFreq: number, compounding: number, yeIndex: number, startYear: number, ye: YearEnd[], result: Answer): [CfArray[], number, number, number] {
  const yeStartDate = parse(`12/31/${thisYear}`, 'MM/dd/yyyy', new Date());

  if (yeStartDate < finalPaymentDate) {
    for (let i = 0; i < c.length; i++) {
        if (c[i + 1].Date < yeStartDate) {
            if (c[i + 1].Kind !== -1) {
                aggregate += c[i + 1].Amount;
            }
            c[i] = null!;
            continue;
        }

        const newEntry: Partial<CfArray> = {
            Date: yeStartDate,
            Amount: 0,
            Kind: -1,
            stubPeriods: 0,
            stubDays: 0
        };

        newEntry.RowID = newEntry.RowID || 0; 
        newEntry.PmtNmbr = newEntry.PmtNmbr || 0; 
        newEntry.CaseCode = newEntry.CaseCode || ''; 

        c.splice(0, i + 1, newEntry as CfArray); 
        break;
    }
      cumulative += aggregate;
      if (annuity.CashFlows[c[1].RowID!]) {
          pFreq = FreqMap[annuity.CashFlows[c[1].RowID!].Frequency];
      }

      if (pFreq !== 0) {
          pFreq = 12 / pFreq;
      } else {
          pFreq = compounding;
      }

      const deferral = {
          from: c[0].Date,
          to: c[1].Date,
          compoundFreq: compounding,
          paymentFreq: pFreq
      };

      [c[1].stubDays, c[1].stubPeriods] = createStubs(deferral);

      amortizeYE(c, annuity);

      yeIndex = yeStartDate.getFullYear() - startYear;
      ye[yeIndex] = {
          Date: thisYear.toString(),
          Value: c[0].Amount,
          Aggregate: aggregate,
          YearlyInterest: getDCFYearlyInterest(thisYear, result),
          YearlyCumulative: cumulative
      };
      aggregate = 0;
  }

  return [c, aggregate, cumulative, yeIndex];
}

function getDCFYearlyInterest(year: number, result: Answer): number {
    const y = year.toString();
    for (const item of result.AmSchedule) {
        if (item.Type!.indexOf(y) > -1) {
            return result.IsAmSchedule! ? item.Interest! : item.DCFInterest!;
        }
    }
    return 0;
}



function aggregate(frequency: string, numberPmts: number, amount: number, cola: number): number {
  if (cola !== 0 && FreqMap[frequency] !== 0) {
      let aggregate: number = 0;
      const colaPeriods: number = FreqMap[frequency];
      let tracker: number = amount;
      for (let i = 0; i < numberPmts; i++) {
          aggregate += amount;
          if ((i + 1) % colaPeriods === 0 && (i + 1) < numberPmts) {
              tracker *= 1 + cola;
              amount = toFixed(tracker, 2);
          }
      }
      return toFixed(aggregate, 2);
  }
  return toFixed(numberPmts * amount, 2);
}



const mockAnnuity: Annuity = {
  DCFCode: "DUMMY_DCF",
  Compounding: "Quarterly",
  Effective: 1.2,
  Nominal: 1.3,
  Label: "DUMMY_LABEL",
  DailyRate: 1.4,
  Desc: "DUMMY_DESC",
  Type: "DUMMY_TYPE",
  Unknown: false,
  UseAmSchedule: false,
  EstimateDCF: 1.5,
  AsOf: new Date(),
  CashFlows: [
    {
      CaseCode: "TEST001",
      ParentChild: "Parent",
      Buyer: "John",
      CfType: "Return",
      First: "2023-01-01",
      Last: "2023-12-31",
      Number: 1,
      Amount: 2000,
      Frequency: "Monthly",
      COLA: 0,
      ColaPeriods: 1,
      Unknown: false,
      Escrow: true
    }
  ],
  Carrier: "DUMMY_CARRIER",
  Aggregate: 1.6,
  CustomCF: false,
  DocumentRecipient: "DUMMY_RECIPIENT"
};


console.log(calcAnnuity(mockAnnuity, true));

calcAnnuity(mockAnnuity, true).then(result => {
  console.log(result);
}).catch(error => {
  console.error(error);
});
