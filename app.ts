function greet(name: string): string {
  return `Hello, ${name}!`;
}

import path from 'path';
import express, { Request, Response } from 'express';
import { Readable } from 'stream';

import { parse } from 'date-fns';

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

interface Answer {
  PV: number;
  DCFpv: number;
  DCFRounding: number;
  Rate: number;
  UnknownRow: number; // Note: In TypeScript, property names are case-sensitive, so "row" instead of "UnknownRow"
  Answer: number;
  Rounding: number;
  WAL: number;
  HWMark: number; // Note: In TypeScript, property names should use camelCase, so "hwmark" instead of "HWMark"
  HWMarkDate: string; // Note: In TypeScript, property names should use camelCase, so "hwMarkDate" instead of "HWMarkDate"
  Term: number;
  IsAmSchedule: boolean; // Note: In TypeScript, property names should use camelCase, so "AmSchedule" instead of "AmSchedule"
  TotalPayout: number; // Note: In TypeScript, property names should use camelCase, so "totalPayout" instead of "TotalPayout"
  isPmtSchedule: boolean; // Note: In TypeScript, property names should use camelCase, so "isPmtSchedule" instead of "IsPmtSchedule"
  AmSchedule: Schedule[]; // Assuming "Schedule" is another type you have defined
  YeValuations: YearEnd[]; // Assuming "YearEnd" is another type you have defined
}
interface Schedule {
  Type: string;
  Date: string;
  Cashflow: number;
  Principal: number;
  Interest: number;
  DCFPrincipal: number;
  DCFInterest: number;
  DCFBalance: number;
  Balance: number;
}

interface ScheduleData {
  balance?: number;
  accruedInterest?: number;
  principal?: number;
  //... any other properties that scheduleData may have
}

interface YearEnd {
  Date: string;
  Value: number;
  Aggregate: number; // You can use the same name as in Go
  YearlyDCFInterest: number; // Use camelCase as per TypeScript naming conventions
  YearlyInterest: number;
  YearlyCumulative: number;
}

interface AnnuityArrayItem {
  RowID: number;
  Date: Date;
  Amount: number;
  Kind: number;
  Escrow: boolean;
  CaseCode: string;
  Owner: string;
  PmtNmbr: number;
  Freq: string;
}

interface Annuity {
  Compounding: string;
  CashFlows: CashFlow[];
}

interface DeferralData {
  pvDate: Date;
  from: Date;
  to: Date;
  compoundFreq: number;
  paymentFreq: number;
}

interface YearEnd {
    Date: string;
    Value: number;
    Aggregate: number;
    YearlyInterest: number;
    YearlyCumulative: number;
}

interface CfArray {
  RowID: number;
  PmtNmbr: number;
  RootPmtPntr: number[];
  CaseCode: string;
  Date: string; // Use string for time in ISO format or use a Date object if preferred
  Amount: number;
  DiscountFactor: number;
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


const FreqMap: { [key: string]: number } = {
  Monthly: 12,
  Quarterly: 4,
  SemiAnnual: 2,
  Annual: 1,
  Payment: 0,
};

type AnnuityArray = AnnuityArrayItem[];

const app = express();
const port = process.env.PORT || 3000;
app.set('view engine', 'ejs');

async function calculator(req: Request, res: Response) {
  try {
    const result = await calc(req, true);

    // Sending JSON response
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof Error) {
      console.error(err);
      res.status(403).send(err.message);
    }
  }
}

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

  if(annuity) {
    let aa = [];
    
      [aa, annuity.AsOf] = newCashflowArray(annuity.CashFlows, annuity.Compounding);
      setStubs(aa, annuity);
    

    if (annuity.Unknown) {
      result.UnknownRow = -1;
      [result.Answer, err] = await amortizeRate(aa, annuity);
      annuity.Effective = effective(result.Answer);
    } else {
      result.UnknownRow = getUnknownRow(annuity);
      annuity.DailyRate = annuity.Nominal / 365;
      [result.Answer, err] = await amortizeCF(aa, annuity, result.UnknownRow);
    }

    if (err === null) {
      result.PV = getAnnuityPV(aa, annuity.AsOf);
      if (result.PV !== 0 && result.DCFpv === 0) {
        result.DCFpv = estimatePV(aa, annuity.Effective);
      }

      annuity.Aggregate = ToFixed(aaAggregate(aa), 2);
      result.WAL = calcWAL(aa, annuity.Aggregate);

      if (schedule) {
        result.AmSchedule = createAmSchedule(result, aa, annuity, paymentCount(annuity.CashFlows));
        result.YeValuations = yearEndSummary(aa, annuity, result);
      }
      result.TotalPayout = annuity.Aggregate;
    }
  }
  return [result, err];
}

function newCashflowArray(pmts: CashFlow[], compounding: string): [AnnuityArray, Date] {
  let pFreq: number, cfType: number, i: number;
  let firstPaymentDate: Date, asOf: Date;
  let sortRequired = false, asOfBool = false;
  const aa: AnnuityArray = new Array<AnnuityArrayItem>(PaymentCount(pmts));

  for (let row = 0; row < pmts.length; row++) {
    const v = pmts[row];
    firstPaymentDate = dateutils.ParseDateFromString(v.First);
    let amount = v.Amount;
    let tracker = amount;

    if (v.COLA !== 0 && v.ColaPeriods === 0) {
      pmts[row].ColaPeriods = FreqMap[v.Frequency];
    }

    if (v.CfType === "Invest") {
      cfType = -1;
      if (!asOfBool) {
        asOf = firstPaymentDate;
        asOfBool = true;
      }
    } else {
      cfType = 1;
    }

    pFreq = FreqMap[v.Frequency] || FreqMap[compounding];
    pFreq = 12 / pFreq;
    const escrow = v.Escrow;

    if (i > 0 && !sortRequired) {
      sortRequired = dateutils.CompareDates(firstPaymentDate, aa[i - 1].Date);
    }

    for (let j = 0; j < v.Number; j++) {
      aa[i] = {
        RowID: row,
        Date: dateutils.AddMonths(firstPaymentDate, j * pFreq),
        Amount: amount,
        Kind: cfType,
        Escrow: escrow,
        CaseCode: v.CaseCode,
        Owner: v.Buyer,
        PmtNmbr: i,
        Freq: v.Frequency,
      };
      i++;

      if ((j + 1) * pFreq % 12 === 0 && v.COLA !== 0 && j !== v.Number - 1) {
        tracker *= 1.0 + v.COLA;
        amount = ToFixed(tracker, 2); // Define ToFixed function as needed
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
        return a.RowID - b.RowID;
      }
    });
  }

  return [aa, asOf];
}


// Assuming that dateutils.AddMonths is similar to date-fns's addMonths
// and dateutils.DiffDays is similar to date-fns's differenceInDays

function getInvestmentValue(annuity: Annuity): number {
  for (let cashFlow of annuity.CashFlows) {
    if (cashFlow.CfType === "Invest") {
      return cashFlow.Amount;
    }
  }
  return 0;
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
  return [
    r.term.ToFixed(1),
    r.wal.ToFixed(1),
  ];
}

function calcWAL(aa: AnnuityArrayItem[], start: Date): number {
  let walAgg = 0;
  let aggregate = 0;
  for (let v of aa) {
    if (v.Date < start) {
      continue;
    }
    const dayDiff = differenceInDays(v.Date, start);
    aggregate += v.Amount;
    walAgg += dayDiff * v.Amount;
  }
  return ToFixed(walAgg / aggregate / 365, 1);
}

function calcWALWithAggregate(aa: AnnuityArrayItem[], aggregate: number): number {
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

    dayDiff = differenceInDays(v.Date, walDate!);
    walAgg += dayDiff * v.Amount;
  }
  return ToFixed(walAgg / aggregate / 365, 1);
}

function nominal(rate: number): number {
  return 12.0 * (Math.pow(rate + 1.0, 1.0 / 12.0) - 1.0);
}

function effective(rate: number): number {
  return Math.pow(1.0 + (rate / 12), 12) - 1;
}

function aaAggregate(aa: AnnuityArrayItem[]): number {
  return aa.reduce((agg, v) => v.Kind === 1 ? agg + v.Amount : agg, 0);
}

function getInvestmentDate(aa: AnnuityArrayItem[]): Date {
  for (let item of aa) {
    if (item.Kind === -1) {
      return item.Date;
    }
  }
  return aa[aa.length - 1].Date;
}

function estimatePV(aa: AnnuityArrayItem[], rate: number): number {
  let pvEstimate = 0;
  const pvDate = getInvestmentDate(aa);
  for (let i = 0; i < aa.length; i++) {
    const v = aa[i];
    if (pvDate.getTime() === v.Date.getTime() && v.Kind === -1) {
      continue;
    } else {
      const period = v.dcfStubPeriods + (v.dcfStubDays / 365 * 12);
      aa[i].DiscountFactor = (1 / Math.pow(1 + rate, period / 12)) * v.Kind;
      aa[i].DCF = ToFixed(aa[i].DiscountFactor * aa[i].Amount, 2);
      pvEstimate += aa[i].DCF;
    }
  }
  return pvEstimate;
}

function amortize(aa: AnnuityArrayItem[], annuity: Annuity): number {
  let interest: number = 0;
  let balance: number = 0;

  for (const v of aa) {
    interest = v.stubDays * annuity.DailyRate * balance;
    balance += interest;
    balance *= Math.pow(1 + annuity.Nominal / FreqMap[annuity.Compounding], v.stubPeriods);
    balance -= v.Amount * v.Kind;
  }

  return balance;
}

function setStubs(aa: AnnuityArrayItem[], annuity: Annuity): void {
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
          // Assuming that `stubDays`, `stubPeriods`, `dcfStubDays`, `dcfStubPeriods` are properties of `AnnuityArrayItem`
          // If not, you need to adjust this part accordingly.
          aa[i].stubDays = aa[i].stubPeriods = aa[i].dcfStubDays = aa[i].dcfStubPeriods = 0;
          continue;
      }

      data.from = aa[i - 1].Date;
      data.to = v.Date;
      data.paymentFreq = FreqMap[annuity.CashFlows[v.RowID].Frequency] || 0;
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

      data.from = data.pvDate;
      [aa[i].dcfStubDays, aa[i].dcfStubPeriods] = createStubs(data);
  }
}

function createStubs(data: DeferralData): [number, number] {
  let countMonths = data.to.getMonth() - data.from.getMonth() + (12 * (data.to.getFullYear() - data.from.getFullYear()));
  if (countMonths !== 0) {
      if (data.to.getDate() < data.from.getDate()) {
          countMonths--;
          if (data.to.getDate() === dateutils.DaysInMonth(data.to.getFullYear(), data.to.getMonth())) {
              countMonths++;
          }
      }
  }
  const countPeriods = Math.floor(countMonths / data.compoundFreq);
  const dt = dateutils.AddMonths(data.to, -countPeriods * data.compoundFreq);
  const stubDays = dateutils.DiffDays(dt, data.from);
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
      balance = amortize(aa, annuity);
      if ((annuity.CashFlows[unknownRow].CfType === "Invest" && balance < 0) || (annuity.CashFlows[unknownRow].CfType !== "Invest" && balance > 0)) {
          min = guess;
      } else {
          max = guess;
      }
  }
  console.log("Number of iterations:", iterations);
  if (annuity.CashFlows[unknownRow].COLA !== 0) {
      updateAnnuity(aa, ToFixed(guess, 2), annuity, unknownRow);
  }
  return [ToFixed(guess, 2), null];
}

function amortize(aa: AnnuityArray, annuity: Annuity): number {
  let interest = 0, balance = 0;
  for (const v of aa) {
      interest = v.stubDays * annuity.DailyRate * balance;
      balance += interest;
      balance *= Math.pow(1 + annuity.Nominal / FreqMap[annuity.Compounding], v.stubPeriods);
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

function ToFixed(num: number, precision: number): number {
  const output = Math.pow(10, precision);
  return round(num * output) / output;
}

function CreateAmSchedule(result: Answer, aa: AnnuityArray, annuity: Annuity, sum: number): Schedule[] {
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
  // dcfBalances(result); // If you have this function, you can uncomment this

  result.AmSchedule = insertSchedTotals(result); // Assuming you have this function somewhere

  annuity.Aggregate = result.AmSchedule[result.AmSchedule.length - 1].Payment;

  return result.AmSchedule;
}

function roundFirstDCFPayment(result: Answer, annuity: Annuity): void {
  for (let i = 0; i < result.AmSchedule.length; i++) {
      const d = new Date(result.AmSchedule[i].Date);

      if (result.AmSchedule[i].Type === "Return" && d.getTime() !== annuity.AsOf.getTime()) {
          result.AmSchedule[i].DCFPrincipal! += ToFixed(result.PV - result.DCFpv, 2);
          result.AmSchedule[i].DCFInterest! -= ToFixed(result.PV - result.DCFpv, 2);
          break;
      }
  }
}

function schedRow(aa: AnnuityArray, index: number, annuity: Annuity, result: Answer): Schedule {
  const data: ScheduleData = {};
  const AnnuityArrayAtIndex = aa[index];

  if (index === 0) {
      return data.amSchedReturnVals(AnnuityArrayAtIndex, index);
  }

  const previousBalance = result.AmSchedule[index - 1].Balance!;
  const stubInterest = AnnuityArrayAtIndex.stubDays * annuity.DailyRate * previousBalance;

  data.balance = stubInterest + previousBalance;
  data.balance *= Math.pow(1 + annuity.Nominal / FreqMap[annuity.Compounding], AnnuityArrayAtIndex.stubPeriods);

  if (result.HWMark < data.balance!) {
      result.HWMark = data.balance!;
      result.HWMarkDate = (new Date(AnnuityArrayAtIndex.Date)).toLocaleDateString("en-US", { month: '2-digit', day: '2-digit', year: 'numeric' });
  }

  data.accruedInterest = data.balance! - previousBalance;
  data.balance -= AnnuityArrayAtIndex.Amount * AnnuityArrayAtIndex.Kind;
  data.balance = ToFixed(data.balance!, 2);

  data.principal = ToFixed(previousBalance - data.balance!, 2);
  return data.amSchedReturnVals(AnnuityArrayAtIndex, index);
}

// Placeholder for any missing functions or types, like `ToFixed`, `insertSchedTotals`, `FreqMap`, `AnnuityArray`, `CfArray`, etc.
// You'd need to define or replace them accordingly.


function insertSchedTotals(result: Answer): Schedule[] {
  const empty: Schedule;
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
          result.AmSchedule.splice(i, 0, empty);
          result.AmSchedule[i] = insertTotals();
          totals.payments = 0;
          totals.interest = 0;
          totals.dcfPayments = 0;
          totals.dcfInterest = 0;
          year = result.AmSchedule[i + 1].Date.slice(-4);
      } else {
          if (result.AmSchedule[i].Type === "Return") {
              totals.payments += ToFixed(result.AmSchedule[i].Payment, 2);
              totals.interest += ToFixed(result.AmSchedule[i].Interest, 2);
              totals.dcfInterest += ToFixed(result.AmSchedule[i].DCFInterest, 2);
              totals.totalDCFInterest += ToFixed(result.AmSchedule[i].DCFInterest, 2);
              totals.totalPayments += ToFixed(result.AmSchedule[i].Payment, 2);
              totals.totalInterest += ToFixed(result.AmSchedule[i].Interest, 2);
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

// Assuming you have defined `amortize` function already in TypeScript.
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

// Continuing with other functions ...

export function YearEndSummary(aa: AnnuityArray, annuity: Annuity, result: Answer): YearEnd[] {
    result.IsAmSchedule = annuity.UseAmSchedule;
    const finalPaymentDate = aa[aa.length - 1].Date;
    const finalYear = finalPaymentDate.getFullYear();
    const compounding = 12 / FreqMap[annuity.Compounding];
    const ye: YearEnd[] = new Array(finalYear - aa[0].Date.getFullYear() + 1);
    const c: CfArray[] = [...aa];
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
        [c, aggregate, cumulativeAgg, yeIndex] = annuity.getYearEndValues(finalPaymentDate, c, aggregate, cumulativeAgg, thisYear, pFreq, compounding, yeIndex, startYear, ye, result);
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

Annuity.prototype.getYearEndValues = function(finalPaymentDate: Date, c: CfArray[], aggregate: number, cumulative: number, thisYear: number, pFreq: number, compounding: number, yeIndex: number, startYear: number, ye: YearEnd[], result: Answer): [CfArray[], number, number, number] {
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
            c.splice(0, i + 1, {
                Date: yeStartDate,
                Amount: 0,
                Kind: -1,
                stubPeriods: 0,
                stubDays: 0
            });
            break;
        }
        cumulative += aggregate;
        pFreq = FreqMap[this.CashFlows[c[1].RowID].Frequency];

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

        amortizeYE(c, this);

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
        if (item.Type.indexOf(y) > -1) {
            return result.IsAmSchedule ? item.Interest : item.DCFInterest;
        }
    }
    return 0;
}


// Assuming you've already defined `FreqMap` and `ToFixed` function in TypeScript.

function aggregate(frequency: string, numberPmts: number, amount: number, cola: number): number {
  if (cola !== 0 && FreqMap[frequency] !== 0) {
      let aggregate: number = 0;
      const colaPeriods: number = FreqMap[frequency];
      let tracker: number = amount;
      for (let i = 0; i < numberPmts; i++) {
          aggregate += amount;
          if ((i + 1) % colaPeriods === 0 && (i + 1) < numberPmts) {
              tracker *= 1 + cola;
              amount = ToFixed(tracker, 2);
          }
      }
      return ToFixed(aggregate, 2);
  }
  return ToFixed(numberPmts * amount, 2);
}
