import { useState } from 'react';
import axios from 'axios';
import { Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { toast } from 'sonner';
import { Progress } from '../components/ui/progress';

const API = "http://localhost:8000/api";

export default function TaskImport() {
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [dryRun, setDryRun] = useState(true);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      if (!selectedFile.name.endsWith('.csv') && !selectedFile.name.endsWith('.xlsx')) {
        toast.error('Please select a CSV or XLSX file');
        return;
      }
      if (selectedFile.size > 10 * 1024 * 1024) {
        toast.error('File size must be less than 10MB');
        return;
      }
      setFile(selectedFile);
      setImportResult(null);
    }
  };

  const downloadTemplate = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API}/imports/template`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'task_import_template.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Template downloaded');
    } catch (error) {
      toast.error('Failed to download template');
    }
  };

  const handleImport = async () => {
    if (!file) {
      toast.error('Please select a file');
      return;
    }

    setImporting(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(`${API}/tasks/import?dry_run=${dryRun}`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      });

      setImportResult(res.data);
      
      if (dryRun) {
        toast.success('Dry run completed - Review results below');
      } else {
        if (res.data.imported_count > 0) {
          toast.success(`Successfully imported ${res.data.imported_count} tasks!`);
        }
        if (res.data.skipped_count > 0) {
          toast.warning(`${res.data.skipped_count} tasks skipped due to errors`);
        }
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div data-testid="task-import-page" className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-4xl font-bold text-[#1a202c]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          Import Tasks
        </h1>
        <p className="text-[#718096] mt-2">Bulk upload tasks from CSV or Excel files</p>
      </div>

      {/* Template Download */}
      <Card className="p-6 bg-gradient-to-br from-[#70bae7]/10 to-[#0a69a7]/5 border-[#70bae7]">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-[#1a202c] mb-2">Download Template</h3>
            <p className="text-sm text-[#718096] mb-4">
              Start by downloading our CSV template with the required columns and format.
            </p>
            <div className="space-y-2 text-sm text-[#4a5568]">
              <p><strong>Required:</strong> Title</p>
              <p><strong>Optional:</strong> Description, AssigneeEmail, Priority, DueDate, Tags, Status</p>
            </div>
          </div>
          <Button
            data-testid="download-template-button"
            onClick={downloadTemplate}
            variant="outline"
            className="ml-4"
          >
            <Download className="w-4 h-4 mr-2" />
            Download Template
          </Button>
        </div>
      </Card>

      {/* File Upload */}
      <Card className="p-6 bg-white border border-[#e2e8f0]">
        <h3 className="text-lg font-semibold text-[#1a202c] mb-4">Upload File</h3>
        
        <div className="border-2 border-dashed border-[#70bae7] rounded-lg p-12 text-center bg-[#70bae7]/5">
          <FileSpreadsheet className="w-16 h-16 mx-auto mb-4 text-[#0a69a7]" />
          <input
            data-testid="file-input"
            type="file"
            accept=".csv,.xlsx"
            onChange={handleFileChange}
            className="hidden"
            id="file-upload"
          />
          <label htmlFor="file-upload" className="cursor-pointer inline-block">
            <div className="px-4 py-2 border border-[#e2e8f0] rounded-md bg-white hover:bg-[#eff2f5] transition-colors flex items-center">
              <Upload className="w-4 h-4 mr-2" />
              Select File
            </div>
          </label>
          <p className="text-sm text-[#718096] mt-3">
            {file ? file.name : 'CSV or XLSX files, max 10MB'}
          </p>
        </div>

        {file && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center space-x-4">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  className="w-4 h-4 text-[#0a69a7] border-[#e2e8f0] rounded"
                />
                <span className="text-sm text-[#1a202c] font-medium">Dry Run (Preview only)</span>
              </label>
              <span className="text-xs text-[#718096]">
                {dryRun ? 'No tasks will be created' : 'Tasks will be created'}
              </span>
            </div>

            <Button
              data-testid="import-button"
              onClick={handleImport}
              disabled={importing}
              className="w-full"
              style={{ backgroundColor: '#0a69a7' }}
            >
              {importing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  {dryRun ? 'Validating...' : 'Importing...'}
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  {dryRun ? 'Validate File' : 'Import Tasks'}
                </>
              )}
            </Button>
          </div>
        )}
      </Card>

      {/* Import Results */}
      {importResult && (
        <Card data-testid="import-results" className="p-6 bg-white border border-[#e2e8f0]">
          <h3 className="text-lg font-semibold text-[#1a202c] mb-4">Import Results</h3>
          
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center p-4 bg-[#eff2f5] rounded-lg">
              <p className="text-2xl font-bold text-[#0a69a7]">{importResult.total_rows}</p>
              <p className="text-sm text-[#718096] mt-1">Total Rows</p>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <CheckCircle2 className="w-6 h-6 mx-auto text-[#48bb78] mb-2" />
              <p className="text-2xl font-bold text-[#48bb78]">{importResult.imported_count}</p>
              <p className="text-sm text-[#718096] mt-1">
                {dryRun ? 'Valid' : 'Imported'}
              </p>
            </div>
            <div className="text-center p-4 bg-red-50 rounded-lg">
              <XCircle className="w-6 h-6 mx-auto text-[#f56565] mb-2" />
              <p className="text-2xl font-bold text-[#f56565]">{importResult.skipped_count}</p>
              <p className="text-sm text-[#718096] mt-1">Errors</p>
            </div>
          </div>

          {importResult.errors && importResult.errors.length > 0 && (
            <div>
              <h4 className="font-medium text-[#1a202c] mb-3 flex items-center">
                <AlertCircle className="w-5 h-5 mr-2 text-[#ed8936]" />
                Validation Errors ({importResult.errors.length})
              </h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {importResult.errors.map((err, idx) => (
                  <div key={idx} className="p-3 bg-red-50 border border-red-200 rounded text-sm">
                    <p className="font-medium text-[#c53030]">
                      Row {err.row}: {err.field}
                    </p>
                    <p className="text-[#742a2a] mt-1">{err.error}</p>
                    {err.value && (
                      <p className="text-xs text-[#742a2a] mt-1">Value: {err.value}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {dryRun && importResult.imported_count > 0 && importResult.errors.length === 0 && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded">
              <p className="text-sm text-[#22543d]">
                ✅ All tasks are valid! Uncheck "Dry Run" and import again to create the tasks.
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
