# Regras do sistema

Este é o manual do que o sistema faz e, principalmente, do **porquê**. Cada
regra aqui está implementada — não é intenção, é comportamento. Quando uma
regra mudar no código, muda aqui junto.

A lógica que atravessa todas elas: **o sistema não afirma o que não pode
provar, e não decide o que é da pessoa decidir.**

---

## 1. Nada entra sem decisão humana

Documento que chega por e-mail não vira lançamento sozinho. Ele para na
**Caixa de entrada** e espera uma de três decisões: aprovar (vira lançamento
novo), anexar (vira prova de um lançamento que já existe) ou rejeitar.

Rejeitar **exige um motivo escrito**, e ele fica no histórico junto com a data.
Uma rejeição sem motivo, meses depois, é indistinguível de um erro.

**Por quê:** leitura automática erra. Um sistema que lança sozinho transfere o
erro da máquina para a contabilidade sem ninguém ver.

---

## 2. O documento fiscal é cobrado por natureza, não por regra geral

Há despesas que nunca vão ter nota fiscal, porque não existe nota a emitir:

| Natureza | Qual é o documento |
|---|---|
| Cobrança do banco — IOF, juros, tarifa, multa | o extrato |
| Tributo — DAS, DARF, INSS, ISS | a guia |
| Parcela de empréstimo | o contrato |

Para essas, o sistema **não cobra nota e não pede justificativa**: a natureza já
é a justificativa. Para todas as outras, dar baixa sem a conferência do extrato
**exige justificativa escrita**.

Quem define a natureza é a **classificação contábil** do lançamento, não uma
palavra na descrição. Lançamento ainda sem categoria exige justificativa: sem
classificação não dá para saber a natureza, e o certo é perguntar, não presumir.

---

## 2b. Guia, folha e pró-labore são sempre despesa

A direção de um documento (receita ou despesa) sai do CNPJ: emitente é a
empresa → receita; destinatário é a empresa → despesa.

Há exceções em que essa regra erra, e erra feio. O recibo de pró-labore é
emitido PELA empresa — é ela quem paga — e a regra concluía "emitente somos
nós, logo é receita". Isso jogaria a folha para dentro do faturamento e subiria
a base do Simples em cima de dinheiro que saiu.

Guia de imposto (DAS, DARF, GPS, GNRE), folha e pró-labore entram **sempre como
despesa**, independentemente de quem consta como emitente.

## 2c. A competência é o período do documento, não a data dele

Recibo de folha de agosto é emitido em setembro. Guia de agosto vence em
setembro. Se a competência vier da data de emissão, a despesa cai no mês
errado — e com ela o Fator R, a DRE e a apuração do mês.

Quando o documento diz a que período se refere, é esse período que manda.

## 3. "Pago" tem dois significados, e eles não se misturam

| Estado | O que significa |
|---|---|
| **Pago** | apareceu no extrato e foi conciliado — é constatação |
| **Pago · a conferir** | alguém registrou a baixa à mão — é afirmação |

Os dois são legítimos: pagamento em dinheiro, conta de banco que não se importa,
compra no cartão e extrato que só chega amanhã são casos reais. O que o sistema
não faz é **mostrar os dois iguais**.

O fechamento do mês informa quantas baixas ficaram sem prova, e o valor delas.
Como aviso, não como trava — quem decide fechar assim é quem fecha.

---

## 4. Escrituração antes da conciliação

Uma nota só é candidata a conciliar depois de **escriturada**: categoria,
classificação contábil e situação fiscal definidas. Nota não revisada não sobe
para a conciliação.

**Por quê:** conciliar é cruzar dinheiro com documento. Cruzar dinheiro com um
documento que ninguém olhou é só fazer bater — e bater não é a mesma coisa que
estar certo.

---

## 5. O mês fechado é travado no banco, não na tela

Fechar um mês grava uma trava no próprio banco de dados: lançamento daquela
competência não muda mais, **nem pelo sistema**. Continuam liberadas apenas a
baixa de pagamento ou recebimento e a prova fiscal.

Reabrir é possível e **exige justificativa** — que fica registrada com a data e
com quem reabriu.

**Por quê:** trava que a tela impõe, a tela tira. Se o número já foi usado para
apurar imposto, ele não pode mudar porque alguém clicou.

---

## 6. O sistema aprende do que você decidiu, nunca do que ele propôs

Vale para a Escrituração e para a Conciliação. Uma cobrança que se repete —
conta de luz, telefone, assinatura — vira proposta automática na vez seguinte,
sob três condições:

1. **só aprende do que foi decidido à mão.** Proposta aceita não vira regra,
   senão o sistema aprende com ele mesmo e um erro vira doutrina;
2. **só vira regra se o histórico for unânime.** Classificada de dois jeitos no
   passado, não há proposta: espera decisão humana;
3. **a regra propõe e diz de onde veio.** Nunca aplica sozinha.


Na Escrituração isso aparece como dois botões que **não se sobrepõem**:
"Escriturar automáticas" aplica o que o sistema já aprendeu e não realimenta o
aprendizado; "Escriturar todos os prontos" são as decisões suas, e é delas que
ele aprende. Um grupo só sai do primeiro para o segundo se você mudar a
classificação proposta.

---

## 7. A conciliação entende o que a linha é antes de procurar par

Cada linha do extrato tem um destino possível: casar com lançamento existente,
ser transferência entre contas próprias, ser movimento de empréstimo, ser
encargo do banco (e aí **não existe par**, o certo é criar), ou não ser da
empresa.

Nas sugestões, a diferença de valor só é tolerada quando há **evidência de
identidade** — nome ou documento da parte. Juros e multa mudam o valor, não
mudam quem recebeu. Sem identidade, valor diferente não vira sugestão: seria
chute, e chute em conciliação é pior que silêncio.

---

## 8. Documento repetido não duplica — e, se trouxer informação nova, enriquece

O mesmo documento chega várias vezes: o contador manda para dois endereços e
reenvia dias seguidos. O sistema reconhece pelo número do documento, ou por
período + tipo + valor quando não há número.

Se a releitura trouxer **campo que não existia antes**, o registro existente é
atualizado em vez de descartado. Descartar seria jogar fora informação nova por
causa de um documento velho.

---

## 9. O robô só paga para ler o que pode ser documento fiscal

A leitura por inteligência artificial é cobrada pelo tamanho do que se manda.
Antes de pagar, o sistema olha o arquivo de graça:

| Peneira | Limite |
|---|---|
| XML | lido por leitor próprio, sem IA — exato e sem custo |
| Tamanho | acima de 4 MB não desce |
| Páginas | acima de 15 não lê — documento fiscal é curto |
| CNPJ | acima de 3 páginas, só lê se o CNPJ da empresa estiver no documento |

Documento de até 3 páginas é sempre lido, mesmo sem texto: é onde moram as
notas fotografadas, e perder uma nota para economizar centavos é mau negócio.

Todo gasto de leitura é registrado, e existe teto mensal configurável.

---

## 10. Cada empresa tem a sua configuração

Não há nada da Polímata fixo no código. Ficam na configuração da empresa:

- **endereço de e-mail** que recebe os documentos;
- **CNPJ**, que identifica se a nota é de entrada ou de saída;
- **data de início** — documento emitido antes dela não é buscado nem aceito.

---

## 11. Moeda estrangeira usa PTAX do dia do documento

Nota em dólar, euro ou libra é convertida pela PTAX da data de emissão —
**compra** para receita, **venda** para despesa. A cotação usada fica gravada no
lançamento, então o valor em real é sempre reconstituível.

---

## Regras fiscais específicas da Polímata

Estas dependem do enquadramento, e mudam de empresa para empresa.

- **Regime de apuração: competência.** A receita declarada no PGDAS-D é a
  emitida no mês, não a recebida. Confirmado contra agosto/2026: R$ 17.830,93
  emitidos × 6,348% = R$ 1.131,90 de DAS.
- **Fator R** define o anexo do Simples: folha dos últimos 12 meses dividida
  pela receita dos últimos 12 meses. A partir de 28%, Anexo III; abaixo, Anexo V.
  Distribuição de lucro **não** é folha.
- **ISS retido** na fonte abate a parcela de ISS da alíquota efetiva, respeitado
  o teto de 5%.
