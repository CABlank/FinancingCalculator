interface CashFlow {
  first: string; 
  caseCode: string;
  parentChild: boolean;
  buyer: string;
  cfType: string; 
  last: Date;
  number: number;
  amount: number;
  frequency: string;
  COLA: number;
  colaPeriods: number;
  unknown: boolean;
  escrow: boolean;
}

interface CfArray {
  rowID: number;
  date: Date;
  formattedDate: string;
  amount: number;
  kind: number;
  escrow: boolean;
  caseCode: string;
  pmtNmbr: number;
  freq: string;
  owner: string;
  // Added stub values as they were present in the Go struct but not in your TypeScript code.
  dcfStubPeriods?: number;  // optional because it wasn't in your original TypeScript interface
  dcfStubDays?: number;     // optional because it wasn't in your original TypeScript interface
  stubPeriods?: number;     // optional because it wasn't in your original TypeScript interface
  stubDays?: number;        // optional because it wasn't in your original TypeScript interface
  compounding: string;
}

type AnnuityArray = CfArray[];


interface Annuity {
  dcfCode?: string; // <-- The '?' makes it optional 
  effective?: number;
  nominal?: number;
  label?: string;
  dailyRate?: number;
  desc?: string;
  type?: string;
  unknown?: boolean;
  useAmSchedule?: boolean;
  estimateDCF: number;
  asOf: Date; // converted time.Time to Date for TS
  cashFlows: CashFlow[];
  carrier: string;
  aggregate: number;
  customCF: boolean;
  documentRecipient: string;
  compounding: string;
  
}




interface Answer {
  unknownRow?: number;
  answer?: number;
  PV?: number;
  DCFpv?: number;
}


const FreqMap: { [key: string]: number } = {
  "Monthly": 1,
  "Quarterly": 3,
  "Semi-Annually": 6,
  "Annually": 12
  // ... add other frequencies if needed
};


function NewCashflowArray(pmts: CashFlow[], compounding: string): [AnnuityArray, Date | undefined] {
  let pFreq: number;
  let cfType: number;
  let firstPaymentDate: Date;
  let asOf: Date | undefined;
  const aa: CfArray[] = [];

  for (let row = 0; row < pmts.length; row++) {
    console.log(`Processing cash flow at row: ${row}`);
    const v = pmts[row];
    firstPaymentDate = parseDateFromString(v.first);
    console.log(`First payment date for row ${row}: ${firstPaymentDate}`);
    let amount = v.amount;

    if (v.cfType === "Return") {
        cfType = -1;
        if (!asOf) {
            asOf = firstPaymentDate;
        }
    } else {
        cfType = 1;
    }
    
    console.log(`Processing cash flow of type: ${v.cfType} (kind: ${cfType})`);

    pFreq = FreqMap[v.frequency];
    if (!pFreq) {
        pFreq = FreqMap[compounding];
    }

    const escrow = v.escrow;

    for (let j = 0; j < v.number; j++) {
      const currentDate = new Date(firstPaymentDate);
      currentDate.setMonth(currentDate.getMonth() + j * pFreq);
  
      aa.push({
        rowID: row,
        date: currentDate,
        formattedDate: formatDateToYYYYMMDD(currentDate),
        amount: amount,
        kind: cfType,
        escrow: escrow,
        caseCode: v.caseCode,
        owner: v.buyer,
        pmtNmbr: row * v.number + j,
        freq: v.frequency,
        compounding: compounding
      });
      
      console.log(`Pushed new cash flow array element for row ${row}, payment number: ${j}`);
  }
  
  }
  aa.sort((a, b) => a.date.getTime() - b.date.getTime() || a.rowID - b.rowID);

  console.log("Final cash flow array:", aa);
  return [aa, asOf];
}



function CalcAnnuity(annuity: Annuity): Promise<{ UnknownRow: number, Answer: number, Effective: number }> {
  let aa: AnnuityArray;
  let result = NewCashflowArray(annuity.cashFlows, annuity.compounding);
  aa = result[0];
  if (result[1]) {
      annuity.asOf = result[1];
  } else {
      // Handle the case where the date is undefined. Maybe set a default date or throw an error.
      annuity.asOf = new Date(); // defaulting to the current date as an example
  }
  if (annuity.unknown) {
    let err: Error | null;
    let resultAnswer: number;

    [resultAnswer, err] = amortizeRate(aa, annuity);
    
    if (err) {
      throw err;
    }

    annuity.effective = Effective(resultAnswer);

    return Promise.resolve({
      UnknownRow: -1,
      Answer: resultAnswer,
      Effective: annuity.effective
    });
  }

  return Promise.resolve({
    UnknownRow: 0, // replace with actual value
    Answer: 0,     // replace with actual value
    Effective: 0   // replace with actual value
});
}


function paymentCount(cfs: CashFlow[]): number {
  let sum = 0;
  for (const v of cfs) {
      sum += v.number;
  }
  return sum;
}

function compareDates(now: Date, prior: Date): boolean {
  return prior > now;
}

function addMonths(date: Date, offset: number): Date {
  let newDate = new Date(date);
  newDate.setMonth(date.getMonth() + offset);
  const dayOfMonth = date.getDate();
  if (dayOfMonth > 28) {
      newDate.setDate(28);
  }
  if (dayOfMonth === getDaysInMonth(date) || dayOfMonth > getDaysInMonth(newDate)) {
      newDate.setDate(getDaysInMonth(newDate));
  } else {
      newDate.setDate(dayOfMonth);
  }
  return newDate;
}

function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function toFixed(num: number, precision: number): number {
  const output = Math.pow(10, precision);
  return Math.round(num * output) / output;
}

function before(value: string, a: string): string {
  const pos = value.indexOf(a);
  if (pos === -1) {
      return "";
  }
  return value.substring(0, pos);
}
function parseDateFromString(dateString: string): Date {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function parseInventoryDateFormat(timeString: string): Date {
  // You will need to implement the parsing logic for this format.
  return new Date(timeString); // Placeholder
}

function parseFBDateFormat(timeString: string): Date {
  // You will need to implement the parsing logic for this format.
  return new Date(timeString); // Placeholder
}

function formatDateToYYYYMMDD(date: Date): string {
  let dd: string | number = date.getDate();
  let mm: string | number = date.getMonth() + 1; // January is 0!
  const yyyy: number = date.getFullYear();
  
  if(dd < 10) {
      dd = '0' + dd;
  } 
  
  if(mm < 10) {
      mm = '0' + mm;
  } 

  return `${yyyy}-${mm}-${dd}`;
}



function amortizeRate(aa: AnnuityArray, annuity: Annuity): [number, Error | null] {
  let guess = 0;
  let balance = 0;
  let min = -1;
  let max = 1;

  while ((max - min) > 0.0000001) {
    guess = (min + max) / 2;

    if (min > 0.99999 || max < -0.99999) {
      return [0, new Error(`Interest rate out of range error with guessed rate = ${guess} and annuity pv = ${annuity.cashFlows[0].amount}`)];
    }

    annuity.nominal = guess;
    annuity.dailyRate = annuity.nominal / 365;
    balance = amortize(aa, annuity); // This function has to be defined

    if (balance > 0) {
      max = guess;
    } else {
      min = guess;
    }
  }

  return [guess, null];
}

function Nominal(rate: number): number {
  return 12.0 * (Math.pow(rate + 1.0, 1.0 / 12.0) - 1.0);
}

function Effective(rate: number): number {
  return Math.pow(1.0 + (rate / 12), 12) - 1;
}


function amortize(aa: AnnuityArray, annuity: Annuity): number {
  let interest = 0;
  let balance = 0;

  aa.forEach(v => {
      if (v.stubDays && v.stubPeriods) {
        interest = v.stubDays * (annuity.dailyRate || 0) * balance;

          balance += interest;
          balance *= Math.pow(1 + (annuity.nominal || 0) / FreqMap[annuity.compounding], v.stubPeriods);
      }
      balance -= v.amount * v.kind;
  });

  return balance;
}



const annuityData: Annuity = {
  cashFlows: [
    {
      first: "2023-01-01",
      amount: 100,
      frequency: "Monthly",
      cfType: "Return",
      number: 6,
      escrow: false,
      caseCode: "",
      buyer: "",
      parentChild: false,  // or true, based on your requirements
      last: new Date("2024-01-01"),
      COLA: 0,  // example value
      colaPeriods: 1,  // example value
      unknown: false  // or true, based on your requirements
    }
  ],
  compounding: "Monthly",
  estimateDCF: 0,   // Place holder value, replace with your actual value
  asOf: new Date(), // Place holder value, replace with your actual value
  carrier: "",      // Place holder value, replace with your actual value
  aggregate: 0,     // Place holder value, replace with your actual value
  customCF: false,  // Place holder value, replace with your actual value
  documentRecipient: "" // Place holder value, replace with your actual value
};




/*CalcAnnuity(annuityData).then(result => {
  console.log(result);
});

*/

// Test Case 1: Simple Loan Repayment
const annuityData1: Annuity = {
  cashFlows: [
    {
      first: "2023-01-01",
      amount: -1000,  // Borrowed amount
      frequency: "Yearly",
      cfType: "Loan",
      number: 1,
      escrow: false,
      caseCode: "",
      buyer: "",
      parentChild: false,
      last: new Date("2024-01-01"),
      COLA: 0,
      colaPeriods: 1,
      unknown: false
    },
    {
      first: "2024-01-01",
      amount: 1100,  // Repayment amount
      frequency: "Yearly",
      cfType: "Return",
      number: 1,
      escrow: false,
      caseCode: "",
      buyer: "",
      parentChild: false,
      last: new Date("2024-01-01"),
      COLA: 0,
      colaPeriods: 1,
      unknown: false
    }
  ],
  compounding: "Monthly",
  estimateDCF: 0,
  asOf: new Date(),
  carrier: "",
  aggregate: 0,
  customCF: false,
  documentRecipient: ""
};

CalcAnnuity(annuityData1).then(result => {
  console.log("Test Case 1 Result:");
  console.log(result);
});
/*
// Test Case 2: Monthly Payments with No Interest
const annuityData2: Annuity = {
  cashFlows: [
    {
      first: "2023-01-01",
      amount: -1200,  // Borrowed amount
      frequency: "Yearly",
      cfType: "Loan",
      number: 1,
      escrow: false,
      caseCode: "",
      buyer: "",
      parentChild: false,
      last: new Date("2024-01-01"),
      COLA: 0,
      colaPeriods: 1,
      unknown: false
    },
    {
      first: "2023-01-01",
      amount: 100,  // Monthly repayment
      frequency: "Monthly",
      cfType: "Return",
      number: 12,
      escrow: false,
      caseCode: "",
      buyer: "",
      parentChild: false,
      last: new Date("2024-01-01"),
      COLA: 0,
      colaPeriods: 1,
      unknown: false
    }
  ],
  //... the rest of your annuity data properties ...
};

// Test Case 3: Monthly Payments with Interest
const annuityData3: Annuity = {
  cashFlows: [
    {
      first: "2023-01-01",
      amount: -1000,  // Borrowed amount
      frequency: "Yearly",
      cfType: "Loan",
      number: 1,
      escrow: false,
      caseCode: "",
      buyer: "",
      parentChild: false,
      last: new Date("2024-01-01"),
      COLA: 0,
      colaPeriods: 1,
      unknown: false
    },
    {
      first: "2023-01-01",
      amount: 100,  // Monthly repayment
      frequency: "Monthly",
      cfType: "Return",
      number: 12,
      escrow: false,
      caseCode: "",
      buyer: "",
      parentChild: false,
      last: new Date("2024-01-01"),
      COLA: 0,
      colaPeriods: 1,
      unknown: false
    }
  ],
  //... the rest of your annuity data properties ...
};

// Running the tests

*/
/* CalcAnnuity(annuityData2).then(result => {
  console.log("Test Case 2 Result:");
  console.log(result);
});

CalcAnnuity(annuityData3).then(result => {
  console.log("Test Case 3 Result:");
  console.log(result);
});*/