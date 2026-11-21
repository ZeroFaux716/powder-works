// Entry point. The simulation and the page are still one shared script for now (the page reads the
// simulation's state directly); vite.config.js joins them into the module 'virtual:game'.
import './style.css';
import 'virtual:game';
