"""戸建の実質土地値と買付上限（安全ライン・許容ライン）を計算する。

標準入力に JSON を渡す。金額の単位は万円（rosenka のみ 円/㎡）。
必須: price_man, land_sqm, rosenka, floor_sqm
任意: structure(wood|steel|rc), junction, boundary, split, norebuild, rent_man, reform_man,
      low_rate, junction_rate, buy_cost_rate, opex_rate, target_yield, recover_years
"""
import json
import math
import sys

DEMO_UNIT = {'wood': 15000, 'steel': 20000, 'rc': 28000}


def hantei(d):
    price = d['price_man'] * 10000
    land = d['land_sqm']
    rosenka = d['rosenka']
    floor = d['floor_sqm']
    reform = d.get('reform_man', 150) * 10000
    rent_year = d.get('rent_man', 0) * 10000 * 12
    junction = d.get('junction', False)
    cost_rate = d.get('buy_cost_rate', 7) / 100
    target = d.get('target_yield', 12) / 100
    years = d.get('recover_years', 5)

    if junction:
        rate, basis = d.get('junction_rate', 100) / 100, '主要国道の交差点付近'
    elif rosenka > 150000:
        rate, basis = 1 / 0.8, '路線価15万円/㎡超（÷0.8）'
    else:
        rate, basis = d.get('low_rate', 70) / 100, '路線価15万円/㎡以下（×70%）'
    land_value = rosenka * land * rate
    demolition = floor * DEMO_UNIT[d.get('structure', 'wood')]
    boundary_cost = 0 if d.get('boundary', True) else 400000
    split_cost = 300000 if d.get('split', False) else 0
    gross_exit = max(land_value - demolition - boundary_cost - split_cost, 0)
    brokerage = min((gross_exit * 0.03 + 60000) * 1.1, gross_exit) if gross_exit > 0 else 0
    net_land = gross_exit - brokerage

    total = price * (1 + cost_rate) + reform
    net_income = rent_year * (1 - d.get('opex_rate', 20) / 100)

    floor10 = lambda yen: max(math.floor(yen / 100000) * 100000, 0)
    yield_line = rent_year / target - reform if rent_year > 0 and target > 0 else math.inf
    land_line = (net_land - reform) / (1 + cost_rate)
    recover_line = (net_land + years * net_income - reform) / (1 + cost_rate)
    safe = floor10(min(land_line, yield_line))
    allow = floor10(min(recover_line, yield_line))

    if d.get('norebuild') or d.get('leasehold') or allow <= 0:
        status = '対象外'
    elif price <= safe:
        status = '対象'
    elif price <= allow:
        status = '条件付き'
    else:
        status = '指値次第'

    man = lambda yen: round(yen / 10000)
    disc = lambda line: None if price <= line else {'万円': man(price - line), '率%': round((price - line) / price * 100)}
    return {
        '判定': status,
        '安全ライン万円': man(safe), '安全ラインまでの指値': disc(safe),
        '許容ライン万円': man(allow), '許容ラインまでの指値': disc(allow),
        '利回りで上限が決まっている': yield_line < land_line,
        '内訳万円': {
            '評価土地値': man(land_value), '掛け目': basis, '解体費': man(demolition),
            '境界確定費': man(boundary_cost), '分筆費用': man(split_cost),
            '売却時仲介手数料': man(brokerage), '実質土地値': man(net_land),
            '購入総額': man(total), '土地値マージン': man(net_land - total),
        },
        '表面利回り%': round(rent_year / (price + reform) * 100, 1) if rent_year else None,
        '実質利回り%': round(net_income / total * 100, 1) if rent_year else None,
    }


if __name__ == '__main__':
    print(json.dumps(hantei(json.load(sys.stdin)), ensure_ascii=False, indent=2))
