import { Component, OnInit, Input, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
import 'rxjs/add/observable/of';
import 'rxjs/add/observable/merge';
import 'rxjs/add/operator/finally';
import { MatSnackBar, MatDialog } from '@angular/material';
import * as moment from 'moment';
import * as _ from 'lodash';

import { BacktestService, Stock, AlgoParam, PortfolioService } from '../shared';
import { OrderDialogComponent } from '../order-dialog/order-dialog.component';
import { Holding } from '../shared/models';
import { FormControl } from '@angular/forms';
import Stocks from './backtest-stocks.constant';
import { ChartDialogComponent } from '../chart-dialog/chart-dialog.component';
import { ChartParam } from '../shared/services/backtest.service';
import { GlobalSettingsService } from '../settings/global-settings.service';
import { OptionsDataService } from '../shared/options-data.service';
import { Subscription, Observable, Subject } from 'rxjs';

export interface Algo {
  value: string;
  viewValue: string;
}

export interface AlgoGroup {
  disabled?: boolean;
  name: string;
  algorithm: Algo[];
}

export interface BacktestResponse extends Stock {
  stock: string;
  algo: string;
  totalTrades: number;
  total: number;
  invested: number;
  returns: number;
  lastVolume: number;
  lastPrice: number;
  recommendation: string;
  buys: number[];
  orderHistory: any[];
  startDate: string;
  endDate: string;
  signals: any[];
  upperResistance: number;
  lowerResistance: number;
}

@Component({
  selector: 'app-rh-table',
  templateUrl: './rh-table.component.html',
  styleUrls: ['./rh-table.component.scss']
})
export class RhTableComponent implements OnInit, OnChanges, OnDestroy {
  @Input() data: AlgoParam[];
  @Input() displayedColumns: string[];

  selectedRecommendation: string[];
  stockList: Stock[] = [];
  currentList: Stock[] = [];
  algoReport = {
    totalReturns: 0,
    totalTrades: 0,
    averageReturns: 0,
    averageTrades: 0
  };

  endDate: string;
  progressPct = 0;
  progress = 0;
  totalStocks = 0;
  interval: number;
  selectedAlgo = 'v2';
  algoControl = new FormControl();
  algoGroups: AlgoGroup[] = [
    {
      name: 'Update Database',
      algorithm: [
        { value: 'intraday', viewValue: 'Intraday Quotes' }
      ]
    },
    {
      name: 'Mean Reversion',
      algorithm: [
        { value: 'v2', viewValue: 'Daily - Bollinger Band' },
        { value: 'v5', viewValue: 'Daily - Money Flow Index' },
        { value: 'v1', viewValue: 'Daily - Moving Average Crossover' },
        { value: 'indicators', viewValue: 'Daily - All Indicators' },
        { value: 'daily-roc', viewValue: 'Daily - Rate of Change/MFI' },
        { value: 'moving_average_resistance', viewValue: 'Daily - Moving Average Resistance' },
        { value: 'v3', viewValue: 'Intraday - MFI' },
        { value: 'v4', viewValue: 'Intraday - Bollinger Band' },
      ]
    }
  ];
  recommendations: any[];
  cols: any[];
  selectedColumns: any[];
  selectedStock: any;
  twoOrMoreSignalsOnly: boolean;
  private callChainSub: Subscription;
  private backtestBuffer: { stock: string; sub: Observable<any>; }[];
  private bufferSubject: Subject<void>;

  constructor(
    public snackBar: MatSnackBar,
    private algo: BacktestService,
    public dialog: MatDialog,
    private portfolioService: PortfolioService,
    private globalSettingsService: GlobalSettingsService,
    private optionsDataService: OptionsDataService) { }

  ngOnInit() {
    this.bufferSubject = new Subject();
    this.backtestBuffer = [];
    this.callChainSub = new Subscription();
    this.recommendations = [
      { value: 'strongbuy', label: 'Strong Buy' },
      { value: 'buy', label: 'Buy' },
      { value: 'sell', label: 'Sell' },
      { value: 'strongsell', label: 'Strong Sell' }
    ];
    this.endDate = moment(this.endDate).format('YYYY-MM-DD');
    this.cols = [
      { field: 'stock', header: 'Stock' },
      { field: 'returns', header: 'Returns' },
      { field: 'lastVolume', header: 'Last Volume' },
      { field: 'lastPrice', header: 'Last Price' },
      { field: 'totalTrades', header: 'Trades' },
      { field: 'strongbuySignals', header: 'Strong Buy' },
      { field: 'buySignals', header: 'Buy' },
      { field: 'sellSignals', header: 'Sell' },
      { field: 'strongsellSignals', header: 'Strong Sell' },
      { field: 'upperResistance', header: 'Upper Resistance' },
      { field: 'lowerResistance', header: 'Lower Resistance' },
      { field: 'impliedMovement', header: 'Implied Movement' }
    ];

    this.selectedColumns = [
      { field: 'stock', header: 'Stock' },
      { field: 'returns', header: 'Returns' },
      { field: 'totalTrades', header: 'Trades' },
      { field: 'strongbuySignals', header: 'Strong Buy' },
      { field: 'buySignals', header: 'Buy' },
      { field: 'sellSignals', header: 'Sell' },
      { field: 'strongsellSignals', header: 'Strong Sell' },
      { field: 'upperResistance', header: 'Upper Resistance' },
      { field: 'lowerResistance', header: 'Lower Resistance' },
      { field: 'impliedMovement', header: 'Implied Movement' }
    ];

    this.selectedRecommendation = ['strongbuy', 'buy', 'sell', 'strongsell'];
    this.filter();
    this.interval = 0;
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes.data && changes.data.currentValue > 0) {
      this.interval = 0;
      this.getData(changes.data.currentValue);
    }
  }

  async getData(algoParams, selectedAlgo = null) {
    const currentDate = moment(this.endDate).format('YYYY-MM-DD');
    const startDate = moment(this.endDate).subtract(700, 'days').format('YYYY-MM-DD');

    this.progress = 0;
    this.totalStocks += algoParams.length;
    this.algoReport = {
      totalReturns: 0,
      totalTrades: 0,
      averageReturns: 0,
      averageTrades: 0
    };

    const algorithm = selectedAlgo ? selectedAlgo : this.selectedAlgo;

    switch (algorithm) {
      case 'v1':
        algoParams.forEach((param) => {
          if (!param.start) {
            param.start = startDate;
          }
          if (!param.end) {
            param.end = currentDate;
          }
          this.algo.getInfo(param)
            .subscribe((stockData: Stock) => {
              stockData.stock = param.ticker;
              stockData.recommendation = stockData.trending;
              stockData.returns = stockData.totalReturns;
              this.addToList(stockData);
              this.incrementProgress();
              this.updateAlgoReport(stockData);
            }, error => {
              console.log('error: ', error);
              this.snackBar.open(`Error on ${param.ticker}`, 'Dismiss');
              this.incrementProgress();
            });
        });
        break;
      case 'v2':
        const bbCb = (param) => {
          return this.algo.getInfoV2(param.ticker, currentDate, startDate)
            .map(
              result => {
                if (result) {
                  result.stock = param.ticker;
                  this.addToList(result);
                  this.incrementProgress();
                  this.updateAlgoReport(result);
                } else {
                  this.snackBar.open(`No results for ${param.ticker}`, 'Dismiss');
                  console.log(`No results for ${param.ticker}`);
                }
              });
        };

        this.iterateAlgoParams(algoParams, bbCb);

        break;
      case 'v3':
        algoParams.forEach((param) => {
          this.algo.getBacktestEvaluation(param.ticker, startDate, currentDate, 'intraday').subscribe(
            result => {
              this.incrementProgress();
            }, error => {
              this.snackBar.open(`Error on ${param.ticker}`, 'Dismiss');
              this.incrementProgress();
            });
        });
        break;
      case 'v4':
        algoParams.forEach((param) => {
          this.algo.getBacktestEvaluation(param.ticker, startDate, currentDate, 'bbands').subscribe(
            result => {
              this.incrementProgress();
            }, error => {
              this.snackBar.open(`Error on ${param.ticker}`, 'Dismiss');
              this.incrementProgress();
            });
        });
        break;
      case 'intraday':
        algoParams.forEach((param) => {
          this.algo.getYahooIntraday(param.ticker)
            .subscribe(
              result => {
                this.algo.postIntraday(result).subscribe(
                  status => {
                  }, error => {
                    this.snackBar.open(`Error on ${param.ticker}`, 'Dismiss');
                    this.incrementProgress();
                  });
              }, error => {
                this.snackBar.open(`Error on ${param.ticker}`, 'Dismiss');
                this.incrementProgress();
              });
        });
        break;
      case 'v5':
        const mfiCb = (param) => {
          return this.algo.getBacktestEvaluation(param.ticker, startDate, currentDate, 'daily-mfi').map(
            (testResults: any[]) => {
              if (testResults.length > 0) {
                const result = testResults[testResults.length - 1];
                result.stock = param.ticker;
                this.addToList(result);
                this.updateAlgoReport(result);
              }
              this.incrementProgress();
            });
        };
        this.iterateAlgoParams(algoParams, mfiCb);

        break;
      case 'daily-roc':
        const rocCb = (param) => {
          return this.algo.getBacktestEvaluation(param.ticker, startDate, currentDate, 'daily-roc')
            .map(
              (testResults: BacktestResponse) => {
                if (testResults) {
                  testResults.stock = param.ticker;
                  this.addToList(testResults);
                  this.updateAlgoReport(testResults);
                }
                this.incrementProgress();
              });
        };
        this.iterateAlgoParams(algoParams, rocCb);

        break;
      case 'daily-indicators':
        const indicatorsCb = (param) => {
          return this.algo.getBacktestEvaluation(param.ticker, startDate, currentDate, 'daily-indicators')
            .map(
              (testResults: BacktestResponse) => {
                if (testResults) {
                  testResults.stock = param.ticker;
                  const macdResults: BacktestResponse = testResults;

                  macdResults.algo = 'MACD';
                  if (macdResults.signals[macdResults.signals.length - 1].recommendation.macd === 'Bullish') {
                    macdResults.recommendation = 'Buy';
                  } else if (macdResults.signals[macdResults.signals.length - 1].recommendation.macd === 'Bearish') {
                    macdResults.recommendation = 'Sell';
                  } else {
                    macdResults.recommendation = 'Neutral';
                  }
                  this.addToList(macdResults);
                  this.updateAlgoReport(macdResults);
                }
                this.incrementProgress();
              });
        };
        this.iterateAlgoParams(algoParams, indicatorsCb);
        break;
      case 'moving_average_resistance':
        const callback = (param) => {
          return this.algo.getResistanceChart(param.ticker, startDate, currentDate).map(
            (result: any) => {
              result.stock = param.ticker;
              this.addToList(result);
              this.updateAlgoReport(result);
              this.incrementProgress();
            });
        };

        this.iterateAlgoParams(algoParams, callback);
        break;
    }
  }

  async iterateAlgoParams(algoParams: any[], callback: Function) {
    for (let i = 0; i < algoParams.length; i++) {
      this.backtestBuffer.push({ stock: algoParams[i].ticker, sub: callback(algoParams[i]) });
    }
    this.executeBacktests();
  }

  incrementProgress() {
    this.progress++;
    this.progressPct = this.convertToPercent(this.progress, this.totalStocks);
  }

  convertToPercent(firstVal, secondVal) {
    return +(Math.round(firstVal / secondVal).toFixed(2)) * 100;
  }

  updateAlgoReport(result: Stock) {
    this.algoReport.totalReturns += result.returns;
    this.algoReport.totalTrades += result.totalTrades;
    this.algoReport.averageReturns = +((this.algoReport.totalReturns / this.totalStocks).toFixed(5));
    this.algoReport.averageTrades = +((this.algoReport.totalTrades / this.totalStocks).toFixed(5));
  }

  filter() {
    this.filterRecommendation();
    if (this.twoOrMoreSignalsOnly) {
      this.filterTwoOrMoreSignalsOnly();
    }
  }

  filterTwoOrMoreSignalsOnly() {
    this.currentList = _.filter(this.currentList, (stock: Stock) => {
      return (stock.strongbuySignals.length + stock.buySignals.length +
        stock.strongsellSignals.length + stock.sellSignals.length) > 1;
    });
  }

  filterRecommendation() {
    this.currentList = [];
    if (this.selectedRecommendation.length === 0) {
      this.currentList = _.clone(this.stockList);
    } else {
      this.currentList = _.filter(this.stockList, (stock: Stock) => {
        for (const recommendation of this.selectedRecommendation) {
          if (this.hasRecommendation(stock, recommendation)) {
            return true;
          }
        }
      });
    }
  }

  hasRecommendation(stock: Stock, recommendation) {
    switch (recommendation) {
      case 'strongbuy':
        return stock.strongbuySignals.length > 0;
      case 'buy':
        return stock.buySignals.length > 0;
      case 'strongsell':
        return stock.strongsellSignals.length > 0;
      case 'sell':
        return stock.sellSignals.length > 0;
    }
  }

  addToList(stock: Stock) {
    this.stockList = this.findAndUpdate(stock, this.stockList);
    this.filter();
  }

  /*
  * Find matching stock in current list and update with new data
  */
  findAndUpdate(stock: Stock, tableList: any[]): Stock[] {
    const idx = _.findIndex(tableList, (s) => s.stock === stock.stock);
    let updateStock;
    if (idx > -1) {
      updateStock = this.updateRecommendationCount(tableList[idx], stock);
      tableList[idx] = updateStock;
    } else {
      updateStock = this.updateRecommendationCount(null, stock);
      tableList.push(updateStock);
    }
    return tableList;
  }

  findStock(symbol, tableList: any[]): Stock {
    return _.find(tableList, (s) => s.stock === symbol);
  }

  updateRecommendationCount(current: Stock, incomingStock: Stock): Stock {
    if (!current) {
      current = incomingStock;
    }
    if (!current.strongbuySignals) {
      current.strongbuySignals = [];
    }
    if (!current.buySignals) {
      current.buySignals = [];
    }
    if (!current.strongsellSignals) {
      current.strongsellSignals = [];
    }
    if (!current.sellSignals) {
      current.sellSignals = [];
    }

    switch (incomingStock.recommendation.toLowerCase()) {
      case 'strongbuy':
        current.strongbuySignals.push(incomingStock.algo);
        current.strongbuySignals = current.strongbuySignals.slice();
        break;
      case 'buy':
        current.buySignals.push(incomingStock.algo);
        current.buySignals = current.buySignals.slice();
        break;
      case 'strongsell':
        current.strongsellSignals.push(incomingStock.algo);
        current.strongsellSignals = current.strongsellSignals.slice();
        break;
      case 'sell':
        current.sellSignals.push(incomingStock.algo);
        current.sellSignals = current.sellSignals.slice();
        break;
    }

    return current;
  }

  sell(row: Stock): void {
    this.order(row, 'Sell');
  }

  buy(row: Stock): void {
    this.order(row, 'Buy');
  }

  order(row: Stock, side: string): void {
    this.portfolioService.getInstruments(row.stock).subscribe((response) => {
      const instruments = response.results[0];
      const newHolding: Holding = {
        instrument: instruments.url,
        symbol: instruments.symbol,
        name: instruments.name,
        realtime_price: row.lastPrice
      };

      const dialogRef = this.dialog.open(OrderDialogComponent, {
        width: '500px',
        height: '500px',
        data: { holding: newHolding, side: side }
      });

      dialogRef.afterClosed().subscribe(result => {
        console.log('Closed dialog', result);
      });
    });
  }

  runDefaultBacktest() {
    this.interval = 0;

    this.getData(Stocks, 'daily-indicators');

    this.getData(Stocks, 'v2');

    this.getData(Stocks, 'v5');

    this.getData(Stocks, 'daily-roc');

    this.progress = 0;
  }

  openChartDialog(element: Stock, endDate) {
    const params: ChartParam = {
      algorithm: this.globalSettingsService.selectedAlgo,
      symbol: element.stock,
      date: endDate,
      params: {
        deviation: this.globalSettingsService.deviation,
        fastAvg: this.globalSettingsService.fastAvg,
        slowAvg: this.globalSettingsService.slowAvg
      }
    };

    const dialogRef = this.dialog.open(ChartDialogComponent, {
      width: '500px',
      height: '500px',
      data: { chartData: params }
    });

    dialogRef.afterClosed().subscribe(result => {
      console.log('Closed dialog', result);
      if (result.algorithm === 'sma' || result.algorithm === 'macrossover') {
        this.globalSettingsService.deviation = result.params.deviation;
        this.globalSettingsService.fastAvg = result.params.fastAvg;
        this.globalSettingsService.slowAvg = result.params.slowAvg;
      }
      this.globalSettingsService.selectedAlgo = result.algorithm;

      this.algo.currentChart.next(result);
    });
  }

  getImpliedMovement(stock: Stock) {
    const symbol = stock.stock;
    const foundStock = this.findStock(symbol, this.stockList);
    this.optionsDataService.getImpliedMove(symbol)
      .subscribe({
        next: data => {
          foundStock.impliedMovement = data.move;
          this.addToList(foundStock);
        }
      });
  }

  executeBacktests() {
    this.bufferSubject.subscribe(() => {
      const backtest = this.backtestBuffer.pop();
      this.callChainSub.add(backtest.sub.subscribe(() => {
        this.triggerNextBacktest();
      }, error => {
        this.snackBar.open(`Error on ${backtest.stock}`, 'Dismiss');
        console.log(`Error on ${backtest.stock}`, error);
        this.incrementProgress();
        this.triggerNextBacktest();
      }));
    });

    this.triggerNextBacktest();
  }

  triggerNextBacktest() {
    if (this.backtestBuffer.length > 0) {
      this.bufferSubject.next();
    }
  }

  ngOnDestroy() {
    this.callChainSub.unsubscribe();
  }
}
