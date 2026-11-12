import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ShadowPage from './components/shadow/ShadowPage.jsx'
import './app.css'

// Two pages, so no router: the pathname is the whole route table.
const path = window.location.pathname.replace(/\/+$/, '')
const Page = path === '/shadow' ? ShadowPage : App

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>,
)
