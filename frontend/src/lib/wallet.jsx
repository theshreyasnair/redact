import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { CHAIN_ID, CHAIN_ID_HEX, CHAIN_PARAMS } from "../config";

const WalletContext = createContext(null);

export function WalletProvider({ children }) {
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [provider, setProvider] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const hasWallet = typeof window !== "undefined" && Boolean(window.ethereum);

  const refresh = useCallback(async () => {
    if (!hasWallet) return;
    const p = new ethers.BrowserProvider(window.ethereum);
    setProvider(p);
    const [accounts, net] = await Promise.all([
      window.ethereum.request({ method: "eth_accounts" }),
      p.getNetwork(),
    ]);
    setAddress(accounts[0] ? ethers.getAddress(accounts[0]) : null);
    setChainId(Number(net.chainId));
  }, [hasWallet]);

  useEffect(() => {
    if (!hasWallet) return;
    refresh().catch(() => {});
    const onAccounts = (accs) => setAddress(accs[0] ? ethers.getAddress(accs[0]) : null);
    const onChain = (hex) => {
      setChainId(parseInt(hex, 16));
      setProvider(new ethers.BrowserProvider(window.ethereum));
    };
    window.ethereum.on("accountsChanged", onAccounts);
    window.ethereum.on("chainChanged", onChain);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccounts);
      window.ethereum.removeListener?.("chainChanged", onChain);
    };
  }, [hasWallet, refresh]);

  const connect = useCallback(async () => {
    setError(null);
    if (!hasWallet) {
      setError("No wallet found. Install MetaMask to continue.");
      return;
    }
    setConnecting(true);
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await refresh();
    } catch (err) {
      setError(err?.message || "Connection rejected");
    } finally {
      setConnecting(false);
    }
  }, [hasWallet, refresh]);

  const switchNetwork = useCallback(async () => {
    if (!hasWallet) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }],
      });
    } catch (err) {
      if (err?.code === 4902 || /unrecognized|not added/i.test(err?.message || "")) {
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [CHAIN_PARAMS] });
      } else {
        throw err;
      }
    }
  }, [hasWallet]);

  const getSigner = useCallback(async () => {
    if (!provider) throw new Error("Wallet not connected");
    return provider.getSigner();
  }, [provider]);

  const value = useMemo(
    () => ({
      hasWallet,
      address,
      chainId,
      isConnected: Boolean(address),
      isCorrectNetwork: chainId === CHAIN_ID,
      connecting,
      error,
      connect,
      switchNetwork,
      getSigner,
    }),
    [hasWallet, address, chainId, connecting, error, connect, switchNetwork, getSigner]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
