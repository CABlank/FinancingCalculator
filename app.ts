function greet(name: string): string {
  return `Hello, ${name}!`;
}

import path from 'path';
import express, { Request, Response } from 'express';
import { Readable } from 'stream';

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
  row: number; // Note: In TypeScript, property names are case-sensitive, so "row" instead of "UnknownRow"
  answer: number;
  rounding: number;
  wal: number;
  hwmark: number; // Note: In TypeScript, property names should use camelCase, so "hwmark" instead of "HWMark"
  hwMarkDate: string; // Note: In TypeScript, property names should use camelCase, so "hwMarkDate" instead of "HWMarkDate"
  term: number;
  isamschedule: boolean; // Note: In TypeScript, property names should use camelCase, so "isamschedule" instead of "IsAmSchedule"
  totalPayout: number; // Note: In TypeScript, property names should use camelCase, so "totalPayout" instead of "TotalPayout"
  isPmtSchedule: boolean; // Note: In TypeScript, property names should use camelCase, so "isPmtSchedule" instead of "IsPmtSchedule"
  schedule: Schedule[]; // Assuming "Schedule" is another type you have defined
  yearend: YearEnd[]; // Assuming "YearEnd" is another type you have defined
}
interface Schedule {
  type: string;
  date: string;
  cashflow: number;
  principal: number;
  interest: number;
  dcfprincipal: number;
  dcfinterest: number;
  dcf_balance: number;
  balance: number;
}

interface YearEnd {
  date: string;
  valuation: number;
  aggregate: number; // You can use the same name as in Go
  yearlyDCFInterest: number; // Use camelCase as per TypeScript naming conventions
  yearlyInterest: number;
  yearlyCumulative: number;
} 

const app = express();
const port = process.env.PORT || 3000;
app.set('view engine', 'ejs');

async function calculator(req: Request, res: Response) {
  try {
    const result = await Calc(req, true);

    // Sending JSON response
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(403).send(err.message);
  }
}

async function Calc(req: Request, schedule: boolean): Promise<{ answer: Answer | undefined; annuity: Annuity | undefined; error: Error | null }> {
  const result: { answer: Answer | undefined; annuity: Annuity | undefined; error: Error | null } = {
    answer: undefined,
    annuity: undefined,
    error: null,
  };

  if (req.headers['content-length'] === '0') {
    result.error = new Error('Please send a request body');
    return result;
  }

  const annuityResponse  = await NewAnnuity(req);
  
  if (!annuityResponse.error) {
    const { answer, error } = CalcAnnuity(annuity, schedule);
    result.answer = answer;
    result.error = error;
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
    error = err;
  }

  return { error, annuity };
}

function calcAnnuity(annuity, schedule) {
  let err = null;
  const result = {};
  let aa = [];
  [aa, annuity.AsOf] = newCashflowArray(annuity.CashFlows, annuity.Compounding);
  setStubs(aa, annuity);

  if (annuity.Unknown) {
    result.UnknownRow = -1;
    [result.Answer, err] = amortizeRate(aa, annuity);
    annuity.Effective = effective(result.Answer);
  } else {
    result.UnknownRow = getUnknownRow(annuity);
    annuity.DailyRate = annuity.Nominal / 365;
    [result.Answer, err] = amortizeCF(aa, annuity, result.UnknownRow);
  }

  if (err === null) {
    result.PV = getAnnuityPV(aa, annuity.AsOf);
    if (result.PV !== 0 && result.DCFpv === 0) {
      result.DCFpv = estimatePV(aa, annuity.Effective);
    }

    annuity.Aggregate = toFixed(aaAggregate(aa), 2);
    result.WAL = calcWAL(aa, annuity.Aggregate);

    if (schedule) {
      result.AmSchedule = createAmSchedule(result, aa, annuity, paymentCount(annuity.CashFlows));
      result.YeValuations = yearEndSummary(aa, annuity, result);
    }
    result.TotalPayout = annuity.Aggregate;
  }

  return [result, err];
}

app.set('views', path.join(__dirname, 'views'));

app.get('/', (req: Request, res: Response) => {
  res.render('index')
});
app.post('/calculator', (req: Request, res: Response) => {
  console.log(req.body)
  
  res.render('index')
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

console.log(greet('John'));