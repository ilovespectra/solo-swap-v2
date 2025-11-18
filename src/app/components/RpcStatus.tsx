import { useState, useEffect } from 'react';
import { TokenService } from '../lib/api';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';

export function RpcStatus() {
  const [status, setStatus] = useState<{ [key: string]: boolean }>({});
  const [loading, setLoading] = useState(true);

  const testRpc = async () => {
    const tokenService = new TokenService();
    const results = await tokenService.testRpcEndpoints();
    setStatus(results);
    setLoading(false);
  };

  useEffect(() => {
    const initializeRpcTest = async () => {
      setLoading(true);
      await testRpc();
    };

    initializeRpcTest();
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    await testRpc();
  };

  return (
    <div className="flex items-center space-x-4 text-xs">
      {/* <span className="text-gray-400">status:</span> */}
      
      {loading ? (
        <div className="flex items-center space-x-1 text-gray-400">
          <RefreshCw className="h-3 w-3 animate-spin" />
          <span>testing...</span>
        </div>
      ) : (
        <>
          {Object.entries(status).map(([name, isOnline]) => (
            <div key={name} className={`flex items-center space-x-1 ${
              isOnline ? 'text-green-400' : 'text-red-400'
            }`}>
              {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              <span>{name}</span>
            </div>
          ))}
          <button
            onClick={handleRefresh}
            className="text-purple-400 hover:text-purple-300 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </>
      )}
    </div>
  );
}