import { Settings, X } from 'lucide-react';

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3 sm:p-4 backdrop-blur-sm">
      <div 
        className="bg-gray-800 rounded-xl p-4 sm:p-6 w-full max-w-md mobile-gradient border border-gray-700 mobile-optimized"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4 sm:mb-6">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center space-x-2 text-optimized">
            <Settings className="h-4 w-4 sm:h-5 sm:w-5" />
            <span>settings</span>
          </h2>
          <button
            onClick={onClose}
            className="p-1 sm:p-2 hover:bg-gray-700 rounded transition-colors mobile-optimized min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Close settings"
          >
            <X className="h-4 w-4 sm:h-5 sm:w-5" />
          </button>
        </div>

        <div className="space-y-3 sm:space-y-4">
          <div>
            <label className="block text-xs sm:text-sm font-medium mb-2">provider</label>
            <select className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 sm:py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-xs sm:text-sm mobile-optimized">
              <option>helius</option>
              <option>quicknode</option>
              <option>public</option>
            </select>
          </div>

          {/* <div>
            <label className="block text-xs sm:text-sm font-medium mb-2">theme</label>
            <select className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 sm:py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-xs sm:text-sm mobile-optimized">
              <option>dark</option>
              <option>light</option>
              <option>system</option>
            </select>
          </div> */}

          <div>
            <label className="block text-xs sm:text-sm font-medium mb-2">refresh interval</label>
            <select className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 sm:py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-xs sm:text-sm mobile-optimized">
              <option>30 seconds</option>
              <option>1 minute</option>
              <option>5 minutes</option>
              {/* <option>manual</option> */}
            </select>
          </div>

          {/* Mobile-optimized action buttons */}
          <div className="pt-4 border-t border-gray-700">
            <div className="flex flex-col sm:flex-row sm:justify-end space-y-2 sm:space-y-0 sm:space-x-3">
              <button
                onClick={onClose}
                className="w-full sm:w-auto bg-gray-600 hover:bg-gray-500 text-white py-2 sm:py-2.5 px-4 rounded-lg font-medium transition-colors mobile-optimized text-sm"
              >
                cancel
              </button>
              <button
                onClick={onClose}
                className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700 text-white py-2 sm:py-2.5 px-4 rounded-lg font-medium transition-colors mobile-optimized text-sm"
              >
                save settings
              </button>
            </div>
          </div>

          {/* Mobile-specific info */}
          <div className="sm:hidden text-xs text-gray-400 text-center pt-2">
            tap outside to close
          </div>
        </div>
      </div>
    </div>
  );
}