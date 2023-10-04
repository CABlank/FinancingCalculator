"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
function greet(name) {
    return `Hello, ${name}!`;
}
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
app.set('view engine', 'ejs');
app.set('views', path_1.default.join(__dirname, 'views'));
app.get('/', (req, res) => {
    res.render('index');
});
app.post('/calculator', (req, res) => {
    console.log(req.body);
    res.render('index');
});
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
console.log(greet('John'));
