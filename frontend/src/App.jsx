import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { WalletProvider } from "./lib/wallet";
import Header from "./components/Header";
import Footer from "./components/Footer";
import Marketplace from "./pages/Marketplace";
import ListingDetail from "./pages/ListingDetail";
import Sell from "./pages/Sell";
import Profile from "./pages/Profile";
import Agent from "./pages/Agent";

function Pages() {
  const location = useLocation();
  return (
    <main key={location.pathname} className="relative flex-1">
      <Routes location={location}>
        <Route path="/" element={<Marketplace />} />
        <Route path="/listing/:id" element={<ListingDetail />} />
        <Route path="/sell" element={<Sell />} />
        <Route path="/agent" element={<Agent />} />
        <Route path="/profile" element={<Profile />} />
      </Routes>
    </main>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <div className="flex min-h-screen flex-col">
          <Header />
          <Pages />
          <Footer />
        </div>
      </BrowserRouter>
    </WalletProvider>
  );
}
